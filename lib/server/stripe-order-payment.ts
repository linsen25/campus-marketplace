// Server-only B21 adapter. Creates/reuses a PaymentIntent; never resolves payment.
import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

type ProviderAttemptRow = {
  id: string
  order_id: string
  buyer_id: string
  provider_platform: string
  provider_operation_id: string
  provider_idempotency_key: string
  provider_customer_ref: string
  provider_instrument_ref: string
  provider_seller_account_ref: string
  provider_amount_cents: number
  provider_currency: 'CAD'
  provider_transfer_group: string
  provider_reference: string | null
  provider_lease: string | null
  claimState?: 'bound' | 'create' | 'in_progress' | 'reconcile'
  confirmable: boolean
}

export type OrderPaymentConfirmation = {
  orderId: string
  attemptId: string
  paymentIntentId: string
} & (
  | { clientSecret: string; nextAction: 'confirm' }
  | { nextAction: 'reconcile' }
)

export function assertStripeOrderPaymentsEnabled() {
  if (process.env.STRIPE_ORDER_PAYMENTS_ENABLED !== 'true')
    throw new ListingApiError(
      'Secure Order payments are awaiting final verification.',
      503
    )
}

async function providerRpc({
  action,
  attemptId,
  buyerId,
  platform,
  token = null,
  value = {},
}: {
  action: 'bind' | 'claim' | 'read' | 'release'
  attemptId: string
  buyerId: string
  platform: string
  token?: string | null
  value?: Record<string, unknown>
}) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_payment_provider',
    {
      p_action: action,
      p_attempt: attemptId,
      p_buyer: buyerId,
      p_platform: platform,
      p_token: token,
      p_value: value,
    }
  )
  if (error) {
    const forbidden = error.code === '42501'
    let status = 503
    if (forbidden) status = 403
    else if (error.code === '23505') status = 409
    throw new ListingApiError(
      forbidden
        ? 'Order not accessible.'
        : 'Payment is processing. Refresh before retrying.',
      status
    )
  }
  return data as ProviderAttemptRow | null
}

export function buildOrderPaymentIntentParams(row: ProviderAttemptRow) {
  const amount = Number(row.provider_amount_cents)
  if (
    row.provider_currency !== 'CAD' ||
    !Number.isSafeInteger(amount) ||
    amount <= 0
  )
    throw new ListingApiError('Invalid frozen Order amount.', 503)
  const params: Stripe.PaymentIntentCreateParams = {
    amount,
    currency: 'cad',
    customer: row.provider_customer_ref,
    payment_method: row.provider_instrument_ref,
    allowed_payment_method_types: ['card'],
    capture_method: 'automatic',
    confirmation_method: 'automatic',
    confirm: false,
    on_behalf_of: row.provider_seller_account_ref,
    transfer_group: row.provider_transfer_group,
    metadata: {
      uu_order: row.order_id,
      uu_attempt: row.id,
      uu_kind: 'marketplace_order',
      uu_environment: 'staging',
    },
  }
  return params
}

function id(value: string | { id: string } | null) {
  return typeof value === 'string' ? value : value?.id || null
}

function validateIntent(
  intent: Stripe.PaymentIntent,
  row: ProviderAttemptRow,
  params: Stripe.PaymentIntentCreateParams
) {
  if (
    intent.livemode ||
    intent.amount !== params.amount ||
    intent.currency !== 'cad' ||
    id(intent.customer) !== row.provider_customer_ref ||
    id(intent.payment_method) !== row.provider_instrument_ref ||
    id(intent.on_behalf_of) !== row.provider_seller_account_ref ||
    intent.transfer_group !== row.provider_transfer_group ||
    intent.metadata.uu_order !== row.order_id ||
    intent.metadata.uu_attempt !== row.id ||
    intent.metadata.uu_kind !== 'marketplace_order' ||
    intent.metadata.uu_environment !== 'staging'
  )
    throw new ListingApiError(
      'Payment requires server reconciliation before retrying.',
      503
    )
}

async function assertSellerChargeReady(
  stripe: Stripe,
  sellerAccountId: string,
  platformCountry: string | null | undefined
) {
  const seller = await stripe.accounts.retrieve(sellerAccountId)
  if (
    !seller.charges_enabled ||
    seller.capabilities?.card_payments !== 'active' ||
    !seller.country ||
    seller.country !== platformCountry
  )
    throw new ListingApiError('Seller payment account is not ready.', 409)
}

async function assertBuyerPaymentMethodReady(
  stripe: Stripe,
  customerId: string,
  paymentMethodId: string
) {
  const method = await stripe.paymentMethods.retrieve(paymentMethodId)
  const customer = id(method.customer)
  const card = method.type === 'card' ? method.card : null
  const now = new Date()
  if (
    method.livemode ||
    customer !== customerId ||
    !card ||
    card.exp_year < now.getUTCFullYear() ||
    (card.exp_year === now.getUTCFullYear() &&
      card.exp_month < now.getUTCMonth() + 1)
  )
    throw new ListingApiError('Buyer payment method is not ready.', 409)
}

export async function prepareOrderPaymentConfirmation(
  attemptId: string,
  buyerId: string
): Promise<OrderPaymentConfirmation> {
  assertStripeOrderPaymentsEnabled()
  const { config, stripe } = await stripeRuntime()
  const platformAccount = await stripe.accounts.retrieve(null)
  const claimed = await providerRpc({
    action: 'claim',
    attemptId,
    buyerId,
    platform: config.platform,
  })
  if (!claimed) throw new ListingApiError('Payment is unavailable.', 503)
  if (claimed.claimState === 'in_progress')
    throw new ListingApiError(
      'Payment is already processing. Refresh before retrying.',
      409
    )
  if (claimed.claimState === 'reconcile')
    throw new ListingApiError(
      'Payment requires server reconciliation before retrying.',
      503
    )
  const params = buildOrderPaymentIntentParams(claimed)
  let intent: Stripe.PaymentIntent
  if (claimed.provider_reference) {
    intent = await stripe.paymentIntents.retrieve(claimed.provider_reference)
  } else {
    await assertBuyerPaymentMethodReady(
      stripe,
      claimed.provider_customer_ref,
      claimed.provider_instrument_ref
    )
    await assertSellerChargeReady(
      stripe,
      claimed.provider_seller_account_ref,
      platformAccount.country
    )
    // This is the only B21 money-provider call. No transfer/refund/payout occurs.
    intent = await stripe.paymentIntents.create(params, {
      idempotencyKey: claimed.provider_idempotency_key,
    })
    validateIntent(intent, claimed, params)
    const bound = await providerRpc({
      action: 'bind',
      attemptId,
      buyerId,
      platform: config.platform,
      token: claimed.provider_lease,
      value: { providerReference: intent.id },
    })
    if (!bound?.confirmable)
      throw new ListingApiError(
        'Order changed while payment was starting. Refresh the Order.',
        409
      )
  }
  validateIntent(intent, claimed, params)
  const current = await providerRpc({
    action: 'read',
    attemptId,
    buyerId,
    platform: config.platform,
  })
  if (!current?.confirmable || current.provider_reference !== intent.id)
    throw new ListingApiError(
      'Order changed while payment was starting. Refresh the Order.',
      409
    )
  const base = {
    orderId: claimed.order_id,
    attemptId: claimed.id,
    paymentIntentId: intent.id,
  }
  if (
    [
      'requires_action',
      'requires_confirmation',
      'requires_payment_method',
    ].includes(intent.status)
  ) {
    if (!intent.client_secret)
      throw new ListingApiError('Payment confirmation is unavailable.', 503)
    return {
      ...base,
      clientSecret: intent.client_secret,
      nextAction: 'confirm',
    }
  }
  return { ...base, nextAction: 'reconcile' }
}
