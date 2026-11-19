import { createHash } from 'crypto'

import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { synchronizeShopBillingEntitlements } from '@/lib/server/shop-billing-entitlements'
import { synchronizeShopBillingReversalEntitlement } from '@/lib/server/shop-billing-reversal-entitlements'
import { registerShopBillingReversalReview } from '@/lib/server/shop-billing-reversal-reviews'
import {
  isShopBillingReversalEvent,
  reconcileShopBillingReversal,
  shopBillingReversalEventTypes,
} from '@/lib/server/shop-billing-reversals'
import {
  shopBillingEntitlementSyncEnabled,
  shopBillingInvoiceReconciliationConfiguration,
  shopBillingInvoiceReconciliationEnabled,
  shopBillingReversalEntitlementSyncEnabled,
  shopBillingReversalReconciliationEnabled,
  shopBillingReversalReviewEnabled,
  shopBillingWebhookConfiguration,
} from '@/lib/server/shop-billing-environment'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

type ClaimedEvent = {
  claimed: boolean
  eventId?: string
  lease?: string
  eventType?: string
  objectId?: string | null
  customerId?: string | null
  subscriptionId?: string | null
  providerCreatedAt?: string | null
}
const supported = new Set([
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.paid',
  'invoice.payment_failed',
  'invoice.payment_action_required',
  ...shopBillingReversalEventTypes,
])

const unavailable = () =>
  new ListingApiError('Shop Billing webhook is unavailable.', 503)
const terminal = () => Object.assign(unavailable(), { billingTerminal: true })

function objectText(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return null
  const item = (value as Record<string, unknown>)[key]
  return typeof item === 'string' && item.length <= 255 ? item : null
}
function nestedText(value: unknown, keys: string[]) {
  let current: unknown = value
  for (const key of keys) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.length <= 255 ? current : null
}
function nestedValue(value: unknown, keys: string[]) {
  let current: unknown = value
  for (const key of keys) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return current
}
function timestamp(seconds: unknown) {
  if (
    typeof seconds !== 'number' ||
    !Number.isSafeInteger(seconds) ||
    seconds < 0
  )
    return null
  return new Date(seconds * 1000).toISOString()
}
function summary(error: unknown) {
  if (error && typeof error === 'object' && 'billingTerminal' in error)
    return { retry: false, error: 'Billing provider state was rejected.' }
  return { retry: true, error: 'Billing provider synchronization failed.' }
}
async function command(
  action: 'ingest' | 'claim' | 'complete' | 'retry' | 'fail',
  platform: string,
  eventId: string,
  value: Record<string, unknown> = {},
  lease: string | null = null
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_event_command',
    {
      p_action: action,
      p_platform: platform,
      p_event_id: eventId,
      p_value: value,
      p_lease: lease,
    }
  )
  if (error) throw unavailable()
  return data as ClaimedEvent
}

function subscriptionState(
  subscription: Stripe.Subscription,
  providerUpdatedAt: string,
  prices: Record<'plus' | 'pro', string>
) {
  if (subscription.livemode || typeof subscription.customer !== 'string')
    throw terminal()
  const item =
    subscription.items.data.length === 1 ? subscription.items.data[0] : null
  const fields = item as unknown as Record<string, unknown> | null
  const price = fields?.price as { id?: unknown } | undefined
  const priceId = typeof price?.id === 'string' ? price.id : null
  const periodStart = timestamp(fields?.current_period_start)
  const periodEnd = timestamp(fields?.current_period_end)
  const tier =
    priceId === prices.plus ? 'plus' : priceId === prices.pro ? 'pro' : null
  if (
    !tier ||
    !periodStart ||
    !periodEnd ||
    ![
      'incomplete',
      'incomplete_expired',
      'trialing',
      'active',
      'past_due',
      'unpaid',
      'paused',
      'canceled',
    ].includes(subscription.status)
  )
    throw terminal()
  return {
    subscriptionId: subscription.id,
    customerId: subscription.customer,
    status: subscription.status,
    tier,
    priceId,
    periodStart,
    periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    canceledAt: timestamp(subscription.canceled_at),
    endedAt: timestamp(subscription.ended_at),
    providerUpdatedAt,
  }
}

type InvoiceReconciliationState =
  | 'verified_paid'
  | 'payment_failed'
  | 'action_required'
  | 'unsupported'
  | 'rejected'

type InvoiceLine = {
  id: string
  amount: number
  priceId: string
  tier: 'plus' | 'pro'
  periodStart: string
  periodEnd: string
}

function invoiceSubscriptionId(invoice: unknown) {
  return (
    objectText(invoice, 'subscription') ||
    nestedText(invoice, ['parent', 'subscription_details', 'subscription'])
  )
}

function invoiceLine(
  value: unknown,
  subscriptionId: string,
  prices: Record<'plus' | 'pro', string>
): InvoiceLine | null {
  if (!value || typeof value !== 'object') return null
  const line = value as Record<string, unknown>
  const priceId =
    nestedText(line, ['pricing', 'price_details', 'price']) ||
    nestedText(line, ['price', 'id'])
  const tier =
    priceId === prices.plus ? 'plus' : priceId === prices.pro ? 'pro' : null
  const period = line.period as Record<string, unknown> | null
  const parent = line.parent as Record<string, unknown> | null
  const subscription = objectText(line, 'subscription')
  const amount = typeof line.amount === 'number' ? line.amount : null
  const start = timestamp(period?.start)
  const end = timestamp(period?.end)
  if (
    typeof line.id !== 'string' ||
    amount === null ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    !priceId ||
    !tier ||
    subscription !== subscriptionId ||
    parent?.type !== 'subscription_item_details' ||
    start === null ||
    end === null ||
    end <= start
  )
    return null
  const subscriptionDetails = parent.subscription_item_details as Record<
    string,
    unknown
  > | null
  if (subscriptionDetails?.proration === true) return null
  return {
    id: line.id,
    amount,
    priceId,
    tier,
    periodStart: start,
    periodEnd: end,
  }
}

function reconciliationValue(
  invoice: unknown,
  lines: unknown[],
  subscription: Stripe.Subscription,
  eventVersion: string,
  eventType: string,
  prices: Record<'plus' | 'pro', string>
) {
  if (!invoice || typeof invoice !== 'object') throw terminal()
  const source = invoice as Record<string, unknown>
  const invoiceId = objectText(source, 'id')
  const customerId = objectText(source, 'customer')
  const subscriptionId = invoiceSubscriptionId(source)
  const status = objectText(source, 'status')
  const currency = objectText(source, 'currency')?.toUpperCase() || null
  const billingReason = objectText(source, 'billing_reason')
  const amountDue = source.amount_due
  const amountPaid = source.amount_paid
  const attemptCount = source.attempt_count
  const paidAt = timestamp(
    nestedValue(source, ['status_transitions', 'paid_at'])
  )
  if (
    !invoiceId ||
    !customerId ||
    !subscriptionId ||
    subscriptionId !== subscription.id ||
    !status ||
    !currency ||
    typeof amountDue !== 'number' ||
    !Number.isSafeInteger(amountDue) ||
    amountDue < 0 ||
    typeof amountPaid !== 'number' ||
    !Number.isSafeInteger(amountPaid) ||
    amountPaid < 0 ||
    typeof attemptCount !== 'number' ||
    !Number.isSafeInteger(attemptCount) ||
    attemptCount < 0
  )
    throw terminal()
  const dueCents = amountDue
  const paidCents = amountPaid
  const attempts = attemptCount
  const candidates = lines
    .map((line) => invoiceLine(line, subscriptionId, prices))
    .filter((line): line is InvoiceLine => line !== null)
  const subscriptionItem =
    subscription.items.data.length === 1
      ? (subscription.items.data[0] as unknown as Record<string, unknown>)
      : null
  const subscriptionPriceId =
    ((subscriptionItem?.price as { id?: unknown } | undefined)?.id as
      | string
      | undefined) || null
  const candidate = candidates.length === 1 ? candidates[0] : null
  const eligible =
    status === 'paid' &&
    currency === 'CAD' &&
    dueCents > 0 &&
    paidCents >= dueCents &&
    (billingReason === 'subscription_create' ||
      billingReason === 'subscription_cycle') &&
    candidate !== null &&
    lines.length === 1 &&
    candidate.amount === dueCents &&
    candidate.priceId === subscriptionPriceId &&
    paidAt !== null
  const state: InvoiceReconciliationState = eligible
    ? 'verified_paid'
    : eventType === 'invoice.payment_action_required'
    ? 'action_required'
    : status === 'open'
    ? 'payment_failed'
    : status === 'paid'
    ? 'unsupported'
    : 'unsupported'
  const line = candidate
  const reason = eligible
    ? ''
    : status === 'paid'
    ? 'Invoice is not an unambiguous paid subscription service period.'
    : status === 'open'
    ? 'Invoice remains unpaid or requires customer action.'
    : 'Invoice is not a supported paid subscription invoice.'
  const digest = createHash('sha256')
    .update(
      JSON.stringify(
        lines.map((item) => {
          if (!item || typeof item !== 'object') return null
          const value = item as Record<string, unknown>
          return {
            id: value.id,
            amount: value.amount,
            subscription: objectText(value, 'subscription'),
            start: nestedValue(value, ['period', 'start']),
            end: nestedValue(value, ['period', 'end']),
            price: nestedText(value, ['pricing', 'price_details', 'price']),
          }
        })
      )
    )
    .digest('hex')
  return {
    invoiceId,
    customerId,
    subscriptionId,
    status,
    currency,
    amountDueCents: dueCents,
    amountPaidCents: paidCents,
    attemptCount: attempts,
    billingReason: billingReason || '',
    priceId: line?.priceId || '',
    tier: line?.tier || '',
    servicePeriodStart: line?.periodStart || '',
    servicePeriodEnd: line?.periodEnd || '',
    providerVersion: eventVersion,
    lineItemCount: lines.length,
    lineItemDigest: digest,
    verificationState: state,
    reason,
    paidAt: paidAt || '',
  }
}

async function reconcileInvoiceClaim(
  platform: string,
  eventId: string,
  claim: ClaimedEvent,
  subscription: Stripe.Subscription
): Promise<{ invoiceId?: string; proofEligible?: boolean } | null> {
  if (!claim.lease || !claim.objectId || !claim.providerCreatedAt)
    throw terminal()
  const config = shopBillingInvoiceReconciliationConfiguration()
  const runtime = await stripeRuntime()
  const invoice = await runtime.stripe.invoices.retrieve(claim.objectId)
  if (invoice.livemode) throw terminal()
  const lineItems = await runtime.stripe.invoices.listLineItems(invoice.id, {
    limit: 100,
  })
  if (lineItems.has_more) throw terminal()
  const value = reconciliationValue(
    invoice,
    lineItems.data,
    subscription,
    claim.providerCreatedAt,
    claim.eventType || '',
    config.prices
  )
  if (claim.customerId && claim.customerId !== value.customerId)
    throw terminal()
  if (claim.subscriptionId && claim.subscriptionId !== value.subscriptionId)
    throw terminal()
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_reconcile_invoice',
    {
      p_platform: platform,
      p_event_id: eventId,
      p_lease: claim.lease,
      p_value: value,
    }
  )
  if (error) {
    if (['23514', '23505', '40001'].includes(error.code || '')) throw terminal()
    throw unavailable()
  }
  if (!data || typeof data !== 'object') return null
  const result = data as Record<string, unknown>
  return {
    invoiceId:
      typeof result.invoiceId === 'string' ? result.invoiceId : undefined,
    proofEligible: result.proofEligible === true,
  }
}

async function synchronizeClaim(
  platform: string,
  eventId: string,
  claim: ClaimedEvent
) {
  if (!claim.lease || !claim.eventType) throw unavailable()
  if (!supported.has(claim.eventType)) {
    await command('complete', platform, eventId, {}, claim.lease)
    return
  }
  if (isShopBillingReversalEvent(claim.eventType)) {
    if (shopBillingReversalReconciliationEnabled()) {
      const reconciliation = await reconcileShopBillingReversal({
        ...claim,
        eventId,
      })
      if (shopBillingReversalReviewEnabled() && reconciliation.reversalStateId)
        await registerShopBillingReversalReview({
          reversalStateId: reconciliation.reversalStateId,
        })
      if (
        shopBillingReversalEntitlementSyncEnabled() &&
        reconciliation.proofEligible &&
        reconciliation.reversalProofId
      )
        await synchronizeShopBillingReversalEntitlement({
          reversalProofId: reconciliation.reversalProofId,
        })
    }
    await command('complete', platform, eventId, {}, claim.lease)
    return
  }
  const subscriptionId = claim.subscriptionId
  if (!subscriptionId || !claim.providerCreatedAt) throw terminal()
  const config = shopBillingWebhookConfiguration()
  const runtime = await stripeRuntime()
  const subscription = await runtime.stripe.subscriptions.retrieve(
    subscriptionId
  )
  const state = subscriptionState(
    subscription,
    claim.providerCreatedAt,
    config.prices
  )
  if (claim.customerId && claim.customerId !== state.customerId)
    throw terminal()
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_sync_subscription',
    {
      p_platform: platform,
      p_event_id: eventId,
      p_lease: claim.lease,
      p_value: state,
    }
  )
  if (error) {
    if (['23514', '23505'].includes(error.code || '')) throw terminal()
    throw unavailable()
  }
  const synchronized =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  const billingSubscriptionId =
    typeof synchronized?.subscriptionId === 'string'
      ? synchronized.subscriptionId
      : null
  let reconciliation: { invoiceId?: string; proofEligible?: boolean } | null =
    null
  if (
    claim.eventType.startsWith('invoice.') &&
    shopBillingInvoiceReconciliationEnabled()
  ) {
    reconciliation = await reconcileInvoiceClaim(
      platform,
      eventId,
      claim,
      subscription
    )
  }
  if (shopBillingEntitlementSyncEnabled() && billingSubscriptionId) {
    await synchronizeShopBillingEntitlements({
      verifiedInvoiceId: reconciliation?.proofEligible
        ? reconciliation.invoiceId
        : null,
      subscriptionId: billingSubscriptionId,
      subscriptionStatus: state.status,
    })
  }
  await command('complete', platform, eventId, {}, claim.lease)
}

export async function processShopBillingWebhookEvent(eventId: string) {
  const config = shopBillingWebhookConfiguration()
  const claim = await command('claim', config.platform, eventId)
  if (!claim.claimed) return
  try {
    await synchronizeClaim(config.platform, eventId, claim)
  } catch (error) {
    const outcome = summary(error)
    await command(
      outcome.retry ? 'retry' : 'fail',
      config.platform,
      eventId,
      { error: outcome.error },
      claim.lease || null
    )
  }
}

export async function receiveShopBillingWebhook(
  rawBody: Buffer,
  signature: string
) {
  const config = shopBillingWebhookConfiguration()
  if (!signature || signature.length > 2048)
    throw new ListingApiError('Invalid Stripe event.', 400)
  const runtime = await stripeRuntime()
  let event: Stripe.Event
  try {
    event = runtime.stripe.webhooks.constructEvent(
      rawBody,
      signature,
      config.webhookSecret
    )
  } catch {
    throw new ListingApiError('Invalid Stripe event.', 400)
  }
  if (event.livemode || (event.account && event.account !== config.platform))
    throw new ListingApiError('Invalid Stripe event.', 400)
  const object = event.data.object as unknown
  const subscriptionId = event.type.startsWith('customer.subscription.')
    ? objectText(object, 'id')
    : objectText(object, 'subscription')
  await command('ingest', config.platform, event.id, {
    eventType: event.type,
    objectId: objectText(object, 'id'),
    customerId: objectText(object, 'customer'),
    subscriptionId,
    payloadSha256: createHash('sha256').update(rawBody).digest('hex'),
    providerCreatedAt: timestamp(event.created),
  })
  await processShopBillingWebhookEvent(event.id)
  return { received: true }
}
