// Account setup ONLY: no PaymentIntent, charges, refunds, transfers or payouts.
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'crypto'

import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import {
  createTrustedFinancialClient,
  projectFinancialCapabilities,
} from '@/lib/server/financial-capabilities-service'
import { stripeConfiguration } from '@/lib/server/stripe-environment'
import {
  enqueueStripeOrderPaymentEvent,
  orderPaymentEventTypes,
} from '@/lib/server/stripe-order-reconciliation'
import { stripeClient, stripeRuntime } from '@/lib/server/stripe-runtime'
import { sellerOnboardingProfile } from '@/lib/server/stripe-seller-profile'

export type SetupKind = 'payment_method' | 'payout_account'
type Binding = {
  id: string
  user_id: string
  kind: SetupKind
  platform: string
  lease: string
  owner_ref: string | null
  instrument_ref: string | null
  setup_ref: string | null
  setup_operation: string | null
  status: string
  refresh_hash: string | null
  refresh_expires_at: string | null
}
async function rpc<T>(
  name: string,
  params: Record<string, unknown>
): Promise<T> {
  const { data, error } = await createTrustedFinancialClient().rpc(name, params)
  if (error)
    throw new ListingApiError(
      'Account setup is still being confirmed. Please retry.',
      503
    )
  return data as T
}
// eslint-disable-next-line max-params -- Private RPC identity, fencing token and bounded patch are kept explicit.
function store<T = Binding>(
  action: string,
  user: string,
  kind: SetupKind,
  platform: string,
  token: string | null = null,
  value = {}
) {
  return rpc<T>('marketplace_stripe_binding', {
    p_action: action,
    p_user: user,
    p_kind: kind,
    p_platform: platform,
    p_token: token,
    p_value: value,
  })
}
async function withBinding<T>(
  user: string,
  kind: SetupKind,
  run: (
    r: Awaited<ReturnType<typeof stripeRuntime>>,
    b: Binding,
    patch: (value: Record<string, unknown>) => Promise<Binding>
  ) => Promise<T>
) {
  const r = await stripeRuntime()
  const claimed = await store<Binding | null>(
    'claim',
    user,
    kind,
    r.config.platform
  )
  if (!claimed)
    throw new ListingApiError(
      'This setup is already being updated. Please retry shortly.',
      409
    )
  let b: Binding = claimed
  const lease = b.lease
  const patch = async (value: Record<string, unknown>) => {
    b = await store('patch', user, kind, r.config.platform, lease, value)
    return b
  }
  try {
    return await run(r, b, patch)
  } finally {
    await store('release', user, kind, r.config.platform, lease).catch(() => {})
  }
}
// Stripe may prune v1 idempotency keys after 24h. Never blindly recreate an
// unresolved object after that window; preserve the operation for recovery.
async function operationKey(b: Binding, kind: 'owner' | 'setup') {
  const op = await store<{
    id: string
    created_at: string
    provider_ref: string | null
  }>('operation', b.user_id, b.kind, b.platform, b.lease, { kind })
  if (
    !op ||
    (!op.provider_ref && Date.now() - Date.parse(op.created_at) > 20 * 3600000)
  )
    throw new ListingApiError(
      'Setup needs server reconciliation before retrying.',
      503
    )
  return `uu:test:${b.platform}:${kind}:${op.id}`
}
async function ensureOwner(
  r: Awaited<ReturnType<typeof stripeRuntime>>,
  b: Binding,
  patch: (v: Record<string, unknown>) => Promise<Binding>
) {
  if (b.owner_ref) return b
  const idempotencyKey = await operationKey(b, 'owner')
  const metadata = { uu_binding: b.id }
  if (b.kind === 'payment_method') {
    const owner = await r.stripe.customers.create(
      { metadata },
      { idempotencyKey }
    )
    if (owner.livemode) throw new Error('Provider mode mismatch')
    return patch({ owner_ref: owner.id })
  }
  // Recipient accounts require a contact email. Resolve it from the authenticated
  // binding's server-owned Auth identity, never from the browser request body.
  const { data, error } =
    await createTrustedFinancialClient().auth.admin.getUserById(b.user_id)
  if (error || !data.user?.email || !data.user.email_confirmed_at)
    throw new ListingApiError(
      'A verified account email is required for payout setup.',
      403
    )
  const owner = await r.stripe.v2.core.accounts.create(
    {
      contact_email: data.user.email,
      identity: { country: 'ca' },
      dashboard: 'express',
      defaults: {
        currency: 'cad',
        responsibilities: {
          fees_collector: 'application',
          losses_collector: 'application',
        },
      },
      configuration: {
        recipient: {
          capabilities: {
            stripe_balance: { stripe_transfers: { requested: true } },
          },
        },
      },
      metadata,
    },
    { idempotencyKey }
  )
  if (owner.livemode) throw new Error('Provider mode mismatch')
  return patch({ owner_ref: owner.id })
}
function owned(
  object: {
    id: string
    livemode?: boolean
    metadata?: Record<string, string> | null
  },
  b: Binding
) {
  if (
    object.id !== b.owner_ref ||
    object.livemode !== false ||
    object.metadata?.uu_binding !== b.id
  )
    throw new Error('Provider ownership mismatch')
}
// eslint-disable-next-line complexity -- Independently verifies setup ownership, replacement safety and card eligibility.
async function buyerProjection(
  r: Awaited<ReturnType<typeof stripeRuntime>>,
  b: Binding,
  patch: (v: Record<string, unknown>) => Promise<Binding>
): Promise<string> {
  if (!b.owner_ref) return 'unset'
  const customer = await r.stripe.customers.retrieve(b.owner_ref)
  if (customer.deleted) {
    await patch({ status: 'needs_attention', project: true })
    return 'unavailable'
  }
  owned(customer, b)
  let methodId = b.instrument_ref
  let setupStatus = 'unset'
  if (b.setup_ref) {
    const setup = await r.stripe.setupIntents.retrieve(b.setup_ref)
    if (
      setup.livemode ||
      setup.customer !== b.owner_ref ||
      setup.metadata?.uu_binding !== b.id ||
      setup.metadata?.uu_operation !== b.setup_operation ||
      setup.payment_method_types.length !== 1 ||
      setup.payment_method_types[0] !== 'card'
    )
      throw new Error('Setup ownership mismatch')
    setupStatus = setup.status
    if (setup.status === 'succeeded')
      methodId =
        typeof setup.payment_method === 'string'
          ? setup.payment_method
          : setup.payment_method?.id || null
  }
  if (!methodId) {
    await patch({ status: 'unset', project: true })
    return setupStatus
  }
  const method = await r.stripe.paymentMethods.retrieve(methodId)
  const card = method.type === 'card' ? method.card : null
  const now = new Date()
  const usable =
    !method.livemode &&
    method.customer === b.owner_ref &&
    card &&
    (card.exp_year > now.getUTCFullYear() ||
      (card.exp_year === now.getUTCFullYear() &&
        card.exp_month >= now.getUTCMonth() + 1))
  if (!usable) {
    // A failed replacement never discards a still-usable existing card.
    if (methodId !== b.instrument_ref && b.instrument_ref) {
      const old = { ...b, setup_ref: null }
      return buyerProjection(r, old, patch)
    }
    await patch({ status: 'needs_attention', project: true })
    return setupStatus
  }
  // Revalidate the fence before a provider-side mutation after network reads.
  await patch({})
  if (customer.invoice_settings.default_payment_method !== method.id)
    await r.stripe.customers.update(
      b.owner_ref,
      { invoice_settings: { default_payment_method: method.id } },
      { idempotencyKey: `uu:test:default:${b.id}:${b.lease}:${method.id}` }
    )
  await patch({
    instrument_ref: method.id,
    status: 'set',
    label: card.brand,
    last4: card.last4,
    project: true,
  })
  return setupStatus
}
export function sellerReadiness(
  account: Stripe.V2.Core.Account,
  bank: Stripe.Account
) {
  const capabilities =
    account.configuration?.recipient?.capabilities?.stripe_balance
  const due = account.requirements?.summary?.minimum_deadline?.status
  const destination = bank.external_accounts?.data.find(
    (a) =>
      a.object === 'bank_account' &&
      a.currency === 'cad' &&
      a.default_for_currency &&
      !['errored', 'verification_failed'].includes(a.status)
  )
  return {
    ready:
      capabilities?.stripe_transfers?.status === 'active' &&
      capabilities?.payouts?.status === 'active' &&
      bank.payouts_enabled &&
      due !== 'currently_due' &&
      due !== 'past_due' &&
      Boolean(destination),
    destination: destination?.object === 'bank_account' ? destination : null,
  }
}
async function sellerProjection(
  r: Awaited<ReturnType<typeof stripeRuntime>>,
  b: Binding,
  patch: (v: Record<string, unknown>) => Promise<Binding>
) {
  if (!b.owner_ref) return
  const account = await r.stripe.v2.core.accounts.retrieve(b.owner_ref, {
    include: ['configuration.recipient', 'requirements', 'identity'],
  })
  owned(account, b)
  // Read-only compatibility adapter for external bank status: same v2 account,
  // not a second v1 connected account or a direct-charge capability requirement.
  const bank = await r.stripe.accounts.retrieve(b.owner_ref)
  const result = sellerReadiness(account, bank)
  const state = result.ready ? 'ready' : 'needs_attention'
  await patch({
    status: state,
    instrument_ref: result.destination?.id || null,
    label: result.destination ? 'Bank account' : null,
    last4: result.destination?.last4 || null,
    project: true,
  })
}
export async function stripeCapabilities(user: string) {
  const config = stripeConfiguration()
  return projectFinancialCapabilities(
    await rpc('marketplace_stripe_capabilities', {
      p_user: user,
      p_platform: config.platform,
    })
  )
}
export function startCardSetup(user: string) {
  return withBinding(user, 'payment_method', async (r, initial, patch) => {
    let b = await ensureOwner(r, initial, patch)
    let rotate = false
    if (b.setup_ref) {
      await buyerProjection(r, b, patch)
      const current = await r.stripe.setupIntents.retrieve(b.setup_ref)
      rotate = ['succeeded', 'canceled'].includes(current.status)
    }
    b = await store('prepare_setup', user, b.kind, b.platform, b.lease, {
      rotate,
    })
    if (!b.setup_ref) {
      const setup = await r.stripe.setupIntents.create(
        {
          customer: b.owner_ref!,
          allowed_payment_method_types: ['card'],
          usage: 'on_session',
          metadata: { uu_binding: b.id, uu_operation: b.setup_operation! },
        },
        { idempotencyKey: await operationKey(b, 'setup') }
      )
      if (setup.livemode || setup.customer !== b.owner_ref)
        throw new Error('Setup mode mismatch')
      b = await patch({ setup_ref: setup.id })
    }
    const setup = await r.stripe.setupIntents.retrieve(b.setup_ref!)
    if (
      !setup.client_secret ||
      setup.livemode ||
      setup.customer !== b.owner_ref ||
      setup.metadata?.uu_binding !== b.id
    )
      throw new Error('Invalid setup result')
    return {
      clientSecret: setup.client_secret,
      publishableKey: r.config.publishableKey,
      returnUrl: `${r.config.origin}/home?section=settings&focus=payments-payouts&stripe_return=card`,
    }
  })
}
const digest = (s: string) => createHash('sha256').update(s).digest('hex')
export function trustedConnectUrl(value: string) {
  const url = new URL(value)
  if (
    url.protocol !== 'https:' ||
    url.hostname !== 'connect.stripe.com' ||
    url.username ||
    url.password
  )
    throw new Error('Invalid onboarding URL')
  return value
}
export function startPayoutSetup(user: string, refreshToken?: string) {
  return withBinding(user, 'payout_account', async (r, initial, patch) => {
    if (
      refreshToken &&
      (!initial.refresh_hash ||
        !Number.isFinite(Date.parse(initial.refresh_expires_at || '')) ||
        Date.parse(initial.refresh_expires_at || '') < Date.now() ||
        !/^[a-f0-9]{64}$/.test(refreshToken) ||
        !timingSafeEqual(
          Buffer.from(digest(refreshToken)),
          Buffer.from(initial.refresh_hash)
        ))
    )
      throw new ListingApiError(
        'This setup link has expired. Return to Settings to continue.',
        403
      )
    const b = await ensureOwner(r, initial, patch)
    // After hosted onboarding starts, Stripe redacts Express profile fields.
    // A redacted null is not proof of a missing value. Prefill only before the
    // first hosted-link attempt, using the existing persisted refresh marker.
    if (!initial.refresh_hash) {
      const account = await r.stripe.v2.core.accounts.retrieve(b.owner_ref!, {
        include: ['defaults'],
      })
      owned(account, b)
      const proposed = await sellerOnboardingProfile(b.user_id)
      const profile: { business_url?: string; product_description?: string } =
        {}
      if (!account.defaults?.profile?.product_description)
        profile.product_description = proposed.product_description
      if (!account.defaults?.profile?.business_url && proposed.business_url)
        profile.business_url = proposed.business_url
      if (Object.keys(profile).length)
        await r.stripe.v2.core.accounts.update(b.owner_ref!, {
          defaults: { profile },
        })
    }
    const token = randomBytes(32).toString('hex')
    await patch({ refresh_hash: digest(token) })
    const link = await r.stripe.v2.core.accountLinks.create(
      {
        account: b.owner_ref!,
        use_case: {
          type: 'account_onboarding',
          account_onboarding: {
            refresh_url: `${r.config.origin}/api/stripe/connect-refresh?state=${token}`,
            return_url: `${r.config.origin}/home?section=settings&focus=payments-payouts&stripe_return=seller`,
          },
        },
      },
      { idempotencyKey: `uu:test:link:${b.id}:${randomUUID()}` }
    )
    if (link.livemode || link.account !== b.owner_ref)
      throw new Error('Invalid link scope')
    return { url: trustedConnectUrl(link.url) }
  })
}
export async function reconcileStripe(
  user: string,
  kinds: SetupKind[] = ['payment_method', 'payout_account']
) {
  let setupStatus = 'unset'
  const config = stripeConfiguration()
  for (const kind of kinds) {
    if (await store('read', user, kind, config.platform)) {
      const status = await withBinding(
        user,
        kind,
        async (r, binding, patch) => {
          if (kind === 'payment_method')
            return buyerProjection(r, binding, patch)
          await sellerProjection(r, binding, patch)
          return 'unset'
        }
      )
      if (kind === 'payment_method') setupStatus = status
    }
  }
  return { capabilities: await stripeCapabilities(user), setupStatus }
}
export const platformSetupEvents = [
  'setup_intent.succeeded',
  'setup_intent.setup_failed',
  'setup_intent.canceled',
  'payment_method.attached',
  'payment_method.detached',
  'payment_method.updated',
  'payment_method.automatically_updated',
  'customer.updated',
  'customer.deleted',
]
export const connectedSetupEvents = [
  'account.external_account.created',
  'account.external_account.updated',
  'account.external_account.deleted',
]
export const accountSetupEvents = [
  'v2.core.account.updated',
  'v2.core.account[configuration.recipient].capability_status_updated',
  'v2.core.account[configuration.recipient].updated',
  'v2.core.account[requirements].updated',
  'v2.core.account[identity].updated',
  'v2.core.account[defaults].updated',
]
// eslint-disable-next-line complexity -- Channel, signature, purpose and account checks must fail closed together.
export async function receiveStripeEvent(
  raw: Buffer,
  signature: string,
  channel: 'account' | 'connected' | 'platform'
) {
  // Verify the raw signature before any provider network or persistence work.
  const { config, stripe } = stripeClient()
  let id: string
  let type: string
  let owner: string | null = null
  let scope = config.platform
  let orderPayment:
    | {
        eventId: string
        eventType: typeof orderPaymentEventTypes[number]
        paymentIntentId: string
      }
    | undefined
  try {
    if (channel === 'account') {
      const event = stripe.parseEventNotification(
        raw,
        signature,
        config.secrets.account
      )
      if (event.livemode) throw new Error('Live mode forbidden')
      id = event.id
      type = event.type
      if (!accountSetupEvents.includes(type)) return
      owner =
        'related_object' in event &&
        event.related_object &&
        'id' in event.related_object
          ? event.related_object.id
          : null
      if (!owner?.startsWith('acct_')) throw new Error('Invalid account event')
      scope = owner
    } else {
      const event = stripe.webhooks.constructEvent(
        raw,
        signature,
        config.secrets[channel]
      )
      if (event.livemode) throw new Error('Live mode forbidden')
      id = event.id
      type = event.type
      if (
        !(
          channel === 'platform' ? platformSetupEvents : connectedSetupEvents
        ).includes(type)
      ) {
        if (
          channel !== 'platform' ||
          !orderPaymentEventTypes.includes(
            type as typeof orderPaymentEventTypes[number]
          )
        )
          return
        if (event.account) throw new Error('Unexpected connected payment event')
        const paymentIntent = event.data.object as unknown as {
          id: string
          object?: string
          metadata?: Record<string, string>
        }
        if (
          paymentIntent.object !== 'payment_intent' ||
          !paymentIntent.id?.startsWith('pi_')
        )
          throw new Error('Invalid payment event')
        // Signed metadata is only a purpose router. A fresh provider retrieval
        // still verifies every immutable binding before applying any outcome.
        if (paymentIntent.metadata?.uu_kind !== 'marketplace_order') return
        orderPayment = {
          eventId: event.id,
          eventType: type as typeof orderPaymentEventTypes[number],
          paymentIntentId: paymentIntent.id,
        }
      }
      const object = event.data.object as unknown as {
        id: string
        customer?: string | null
      }
      if (channel === 'connected') {
        if (!event.account?.startsWith('acct_'))
          throw new Error('Missing account scope')
        scope = event.account
        owner = event.account
      } else {
        if (event.account) throw new Error('Unexpected connected event')
        owner = type.startsWith('customer.')
          ? object.id
          : object.customer || null
        // Detached PaymentMethods omit customer; resolve binding by active PM below.
        if (!owner && type === 'payment_method.detached') owner = object.id
      }
    }
  } catch {
    throw new ListingApiError('Invalid Stripe event.', 400)
  }
  // Persistence errors intentionally escape as 503 so Stripe retries delivery.
  if (orderPayment) {
    await enqueueStripeOrderPaymentEvent(orderPayment)
    return
  }
  await rpc('marketplace_stripe_events', {
    p_action: 'enqueue',
    p_platform: config.platform,
    p_value: { id, type, scope, owner },
  })
}
export async function drainStripeEvents(limit = 20) {
  const config = stripeConfiguration()
  let processed = 0
  for (let n = 0; n < Math.min(limit, 20); n++) {
    const e = await rpc<{
      event_id: string
      account_scope: string
      lease: string
      binding: { user_id: string; kind: SetupKind } | null
    } | null>('marketplace_stripe_events', {
      p_action: 'claim',
      p_platform: config.platform,
    })
    if (!e) break
    const value = { id: e.event_id, scope: e.account_scope, lease: e.lease }
    try {
      if (!e.binding) throw new Error('Binding not ready')
      await reconcileStripe(e.binding.user_id, [e.binding.kind])
      await rpc('marketplace_stripe_events', {
        p_action: 'done',
        p_platform: config.platform,
        p_value: value,
      })
      processed++
    } catch {
      await rpc('marketplace_stripe_events', {
        p_action: 'retry',
        p_platform: config.platform,
        p_value: value,
      })
    }
  }
  return { processed }
}
