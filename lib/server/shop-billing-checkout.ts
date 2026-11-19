import { createHash } from 'crypto'

import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import {
  shopBillingCheckoutConfiguration,
  type ShopBillingPlan,
} from '@/lib/server/shop-billing-environment'
import { createShopMembershipRepository } from '@/lib/server/shop-membership-repository'
import { stripeRuntime } from '@/lib/server/stripe-runtime'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'

type CheckoutInput = {
  tier: ShopBillingPlan
  membershipRevision: number
  actionId: string
}
type CommandResult = {
  state: 'prepared' | 'checkout_created' | 'failed'
  providerCustomerId: string | null
  checkoutSessionId: string | null
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function unavailable() {
  return new ListingApiError('Shop Billing checkout is unavailable.', 503)
}

export function parseShopBillingCheckoutInput(value: unknown): CheckoutInput {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ListingApiError('Provide a valid Shop Billing checkout request.')
  const body = value as Record<string, unknown>
  if (
    Object.keys(body).length !== 3 ||
    !['tier', 'membershipRevision', 'actionId'].every((key) => key in body) ||
    !['plus', 'pro'].includes(body.tier as string) ||
    !Number.isSafeInteger(body.membershipRevision) ||
    (body.membershipRevision as number) < 0 ||
    typeof body.actionId !== 'string' ||
    !uuid.test(body.actionId)
  )
    throw new ListingApiError('Provide a valid Shop Billing checkout request.')
  return {
    tier: body.tier as ShopBillingPlan,
    membershipRevision: body.membershipRevision as number,
    actionId: body.actionId,
  }
}

function digest(value: Record<string, unknown>) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function validateCommand(value: unknown): CommandResult {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw unavailable()
  const result = value as Record<string, unknown>
  if (
    !['prepared', 'checkout_created', 'failed'].includes(
      result.state as string
    ) ||
    (result.providerCustomerId !== null &&
      (typeof result.providerCustomerId !== 'string' ||
        !/^cus_[A-Za-z0-9]+$/.test(result.providerCustomerId))) ||
    (result.checkoutSessionId !== null &&
      (typeof result.checkoutSessionId !== 'string' ||
        !/^cs_(test_)?[A-Za-z0-9]+$/.test(result.checkoutSessionId)))
  )
    throw unavailable()
  return result as CommandResult
}

async function command(
  action: 'prepare' | 'bind_customer' | 'record_checkout',
  owner: string,
  input: CheckoutInput,
  platform: string,
  value: Record<string, unknown>
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_checkout_command',
    {
      p_action: action,
      p_owner: owner,
      p_action_id: input.actionId,
      p_platform: platform,
      p_value: value,
    }
  )
  if (error) {
    if (['23505', '40001'].includes(error.code || ''))
      throw new ListingApiError(
        'Shop Billing checkout changed. Please refresh.',
        409
      )
    if (error.code === '42501')
      throw new ListingApiError('An eligible owned Shop is required.', 403)
    if (['23514', '22P02'].includes(error.code || ''))
      throw new ListingApiError('Invalid Shop Billing checkout request.')
    throw unavailable()
  }
  return validateCommand(data)
}

function assertTestObject(
  object: { livemode?: boolean; metadata?: Stripe.Metadata | null },
  owner: string
) {
  if (
    object.livemode ||
    object.metadata?.uu_shop_billing_owner !== owner ||
    object.metadata?.uu_shop_billing_scope !== 'membership'
  )
    throw unavailable()
}

export async function startShopBillingCheckout(
  context: MarketplaceContext,
  value: unknown
) {
  const input = parseShopBillingCheckoutInput(value)
  const config = shopBillingCheckoutConfiguration()
  const client = createMarketplaceClient(context)
  const user = await requireMarketplaceUser(client)
  const membership = await createShopMembershipRepository(
    context
  ).getOwnMembership()
  if (membership.revision !== input.membershipRevision)
    throw new ListingApiError('Shop membership changed. Please refresh.', 409)

  let state = await command('prepare', user.id, input, config.platform, {
    tier: input.tier,
    membershipRevision: input.membershipRevision,
  })
  const runtime = await stripeRuntime()
  let customerId = state.providerCustomerId
  if (!customerId) {
    const customer = await runtime.stripe.customers.create(
      {
        metadata: {
          uu_shop_billing_owner: user.id,
          uu_shop_billing_scope: 'membership',
        },
      },
      {
        idempotencyKey: `uu:test:shop-billing:customer:${config.platform}:${user.id}`,
      }
    )
    assertTestObject(customer, user.id)
    state = await command('bind_customer', user.id, input, config.platform, {
      customerId: customer.id,
    })
    customerId = state.providerCustomerId
  }
  if (!customerId) throw unavailable()

  let session: Stripe.Checkout.Session
  if (state.checkoutSessionId) {
    session = await runtime.stripe.checkout.sessions.retrieve(
      state.checkoutSessionId
    )
  } else {
    session = await runtime.stripe.checkout.sessions.create(
      {
        mode: 'subscription',
        customer: customerId,
        line_items: [{ price: config.prices[input.tier], quantity: 1 }],
        success_url: `${config.origin}/?shop_billing=checkout_complete`,
        cancel_url: `${config.origin}/?shop_billing=checkout_cancelled`,
        metadata: {
          uu_shop_billing_owner: user.id,
          uu_shop_billing_scope: 'membership',
        },
        subscription_data: {
          metadata: {
            uu_shop_billing_owner: user.id,
            uu_shop_billing_scope: 'membership',
          },
        },
      },
      {
        idempotencyKey: `uu:test:shop-billing:checkout:${config.platform}:${input.actionId}`,
      }
    )
    assertTestObject(session, user.id)
    state = await command('record_checkout', user.id, input, config.platform, {
      sessionId: session.id,
    })
  }
  if (!session.url || session.livemode) throw unavailable()
  return { checkoutUrl: session.url, actionId: input.actionId }
}

export const shopBillingCheckoutDigest = digest
