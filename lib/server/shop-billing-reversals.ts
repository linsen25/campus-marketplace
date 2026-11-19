import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { shopBillingReversalReconciliationConfiguration } from '@/lib/server/shop-billing-environment'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

export const shopBillingReversalEventTypes = [
  'refund.created',
  'refund.updated',
  'charge.refunded',
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
  'invoice.voided',
  'invoice.marked_uncollectible',
] as const

type ReversalEventType = typeof shopBillingReversalEventTypes[number]
type ReversalType = 'refund' | 'dispute' | 'invoice_reversal' | 'charge_refund'
type Classification = 'verified_full_reversal' | 'manual_review' | 'observed'

type ReversalValue = {
  sourceObjectId: string
  reversalId: string
  reversalType: ReversalType
  sourceStatus: string
  customerId: string
  subscriptionId: string
  invoiceId: string
  amountCents: number
  currency: 'CAD'
  classification: Classification
  providerVersion: string
}

export type ShopBillingReversalReconciliationResult = {
  reversalProofId?: string
  reversalStateId?: string
  classification?: Classification
  proofEligible: boolean
}

type ClaimedReversalEvent = {
  eventId?: string
  lease?: string
  eventType?: string
  objectId?: string | null
  providerCreatedAt?: string | null
}

const unavailable = () =>
  new ListingApiError(
    'Shop Billing reversal reconciliation is unavailable.',
    503
  )
const terminal = () => Object.assign(unavailable(), { billingTerminal: true })

function text(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return null
  const result = (value as Record<string, unknown>)[key]
  return typeof result === 'string' && result.length <= 255 ? result : null
}

function nestedText(value: unknown, keys: string[]) {
  let current: unknown = value
  for (const key of keys) {
    if (!current || typeof current !== 'object') return null
    current = (current as Record<string, unknown>)[key]
  }
  return typeof current === 'string' && current.length <= 255 ? current : null
}

function amount(value: unknown, key: string) {
  if (!value || typeof value !== 'object') return null
  const result = (value as Record<string, unknown>)[key]
  return typeof result === 'number' &&
    Number.isSafeInteger(result) &&
    result >= 0
    ? result
    : null
}

function asObject(value: unknown) {
  return value && typeof value === 'object'
    ? (value as Record<string, unknown>)
    : null
}

function invoiceSubscriptionId(invoice: unknown) {
  return (
    text(invoice, 'subscription') ||
    nestedText(invoice, ['parent', 'subscription_details', 'subscription'])
  )
}

function isTestObject(value: unknown) {
  return text(value, 'id') !== null && asObject(value)?.livemode === false
}

function eventVersion(value: string | null | undefined) {
  if (!value || Number.isNaN(Date.parse(value))) throw terminal()
  return value
}

function validateId(value: string | null, expression: RegExp) {
  if (!value || !expression.test(value)) throw terminal()
  return value
}

async function invoiceContext(
  stripe: Stripe,
  invoiceId: string,
  prices: Record<'plus' | 'pro', string>
) {
  const invoice = (await stripe.invoices.retrieve(invoiceId)) as unknown
  if (!isTestObject(invoice) || text(invoice, 'id') !== invoiceId)
    throw terminal()
  const customerId = validateId(text(invoice, 'customer'), /^cus_[A-Za-z0-9]+$/)
  const subscriptionId = validateId(
    invoiceSubscriptionId(invoice),
    /^sub_[A-Za-z0-9]+$/
  )
  const currency = text(invoice, 'currency')?.toUpperCase()
  const paid = amount(invoice, 'amount_paid')
  const due = amount(invoice, 'amount_due')
  if (currency !== 'CAD' || paid === null || due === null) throw terminal()
  const lines = await stripe.invoices.listLineItems(invoiceId, { limit: 100 })
  if (lines.has_more) throw terminal()
  const candidate = lines.data.length === 1 ? asObject(lines.data[0]) : null
  const priceId =
    nestedText(candidate, ['pricing', 'price_details', 'price']) ||
    nestedText(candidate, ['price', 'id'])
  const proration =
    asObject(asObject(candidate)?.parent)?.subscription_item_details &&
    (
      asObject(asObject(candidate)?.parent)
        ?.subscription_item_details as Record<string, unknown>
    ).proration === true
  const unambiguous =
    candidate !== null &&
    text(candidate, 'subscription') === subscriptionId &&
    !proration &&
    (priceId === prices.plus || priceId === prices.pro)
  return { invoice, customerId, subscriptionId, paid, due, unambiguous }
}

async function invoiceFromPaymentIntent(
  stripe: Stripe,
  paymentIntentId: string
) {
  const paymentIntent = (await stripe.paymentIntents.retrieve(
    paymentIntentId
  )) as unknown
  if (!isTestObject(paymentIntent)) throw terminal()
  const invoiceId = validateId(
    text(paymentIntent, 'invoice'),
    /^in_[A-Za-z0-9]+$/
  )
  return { invoiceId, customerId: text(paymentIntent, 'customer') }
}

async function paymentIntentFromCharge(stripe: Stripe, chargeId: string) {
  const charge = (await stripe.charges.retrieve(chargeId)) as unknown
  if (!isTestObject(charge)) throw terminal()
  const paymentIntentId = validateId(
    text(charge, 'payment_intent'),
    /^pi_[A-Za-z0-9]+$/
  )
  return {
    paymentIntentId,
    customerId: text(charge, 'customer'),
    currency: text(charge, 'currency')?.toUpperCase() || null,
  }
}

function classifyRefund(
  status: string | null,
  reversalAmount: number,
  invoice: { paid: number; due: number; unambiguous: boolean }
): Classification {
  return status === 'succeeded' &&
    invoice.unambiguous &&
    invoice.paid > 0 &&
    invoice.paid === invoice.due &&
    reversalAmount === invoice.paid
    ? 'verified_full_reversal'
    : 'manual_review'
}

function classifyDispute(
  eventType: ReversalEventType,
  status: string | null,
  reversalAmount: number,
  invoice: { paid: number; due: number; unambiguous: boolean }
): Classification {
  const finalLoss =
    status === 'lost' || eventType === 'charge.dispute.funds_withdrawn'
  return finalLoss &&
    invoice.unambiguous &&
    invoice.paid > 0 &&
    invoice.paid === invoice.due &&
    reversalAmount === invoice.paid
    ? 'verified_full_reversal'
    : finalLoss
    ? 'manual_review'
    : 'observed'
}

async function refundValue(
  stripe: Stripe,
  event: ClaimedReversalEvent,
  prices: Record<'plus' | 'pro', string>
): Promise<ReversalValue> {
  const refund = (await stripe.refunds.retrieve(
    event.objectId || ''
  )) as unknown
  if (!isTestObject(refund)) throw terminal()
  const refundId = validateId(text(refund, 'id'), /^re_[A-Za-z0-9]+$/)
  const refundAmount = amount(refund, 'amount')
  const refundCurrency = text(refund, 'currency')?.toUpperCase()
  const paymentIntentId = text(refund, 'payment_intent')
  const chargeId = text(refund, 'charge')
  const payment = paymentIntentId
    ? {
        paymentIntentId: validateId(paymentIntentId, /^pi_[A-Za-z0-9]+$/),
        customerId: null,
      }
    : chargeId
    ? await paymentIntentFromCharge(
        stripe,
        validateId(chargeId, /^ch_[A-Za-z0-9]+$/)
      )
    : null
  if (!payment || refundAmount === null || refundCurrency !== 'CAD')
    throw terminal()
  const resolved = await invoiceFromPaymentIntent(
    stripe,
    payment.paymentIntentId
  )
  const invoice = await invoiceContext(stripe, resolved.invoiceId, prices)
  if (resolved.customerId && resolved.customerId !== invoice.customerId)
    throw terminal()
  return {
    sourceObjectId: validateId(event.objectId || null, /^re_[A-Za-z0-9]+$/),
    reversalId: refundId,
    reversalType: 'refund',
    sourceStatus: text(refund, 'status') || 'unknown',
    customerId: invoice.customerId,
    subscriptionId: invoice.subscriptionId,
    invoiceId: resolved.invoiceId,
    amountCents: refundAmount,
    currency: 'CAD',
    classification: classifyRefund(
      text(refund, 'status'),
      refundAmount,
      invoice
    ),
    providerVersion: eventVersion(event.providerCreatedAt),
  }
}

async function chargeRefundValue(
  stripe: Stripe,
  event: ClaimedReversalEvent,
  prices: Record<'plus' | 'pro', string>
): Promise<ReversalValue> {
  const chargeId = validateId(event.objectId || null, /^ch_[A-Za-z0-9]+$/)
  const charge = await paymentIntentFromCharge(stripe, chargeId)
  if (charge.currency !== 'CAD') throw terminal()
  const resolved = await invoiceFromPaymentIntent(
    stripe,
    charge.paymentIntentId
  )
  const invoice = await invoiceContext(stripe, resolved.invoiceId, prices)
  const refunds = await stripe.refunds.list({ charge: chargeId, limit: 100 })
  if (refunds.has_more) throw terminal()
  const completed = refunds.data.filter(
    (item) =>
      asObject(item)?.livemode === false && text(item, 'status') === 'succeeded'
  )
  const refund = completed.length === 1 ? completed[0] : null
  const refundAmount = refund ? amount(refund, 'amount') : null
  if (refund && text(refund, 'currency')?.toUpperCase() !== 'CAD')
    throw terminal()
  const refundId = refund ? text(refund, 'id') : chargeId
  const full =
    refund && refundAmount !== null
      ? classifyRefund('succeeded', refundAmount, invoice)
      : 'manual_review'
  return {
    sourceObjectId: chargeId,
    reversalId: validateId(refundId, /^(re|ch)_[A-Za-z0-9]+$/),
    reversalType: refund ? 'refund' : 'charge_refund',
    sourceStatus: refund ? 'succeeded' : 'ambiguous_charge_refund',
    customerId: invoice.customerId,
    subscriptionId: invoice.subscriptionId,
    invoiceId: resolved.invoiceId,
    amountCents: refundAmount === null ? 0 : refundAmount,
    currency: 'CAD',
    classification: full,
    providerVersion: eventVersion(event.providerCreatedAt),
  }
}

async function disputeValue(
  stripe: Stripe,
  event: ClaimedReversalEvent,
  prices: Record<'plus' | 'pro', string>
): Promise<ReversalValue> {
  const dispute = (await stripe.disputes.retrieve(
    event.objectId || ''
  )) as unknown
  if (!isTestObject(dispute)) throw terminal()
  const disputeId = validateId(text(dispute, 'id'), /^dp_[A-Za-z0-9]+$/)
  const chargeId = validateId(text(dispute, 'charge'), /^ch_[A-Za-z0-9]+$/)
  const disputeAmount = amount(dispute, 'amount')
  if (
    disputeAmount === null ||
    text(dispute, 'currency')?.toUpperCase() !== 'CAD'
  )
    throw terminal()
  const charge = await paymentIntentFromCharge(stripe, chargeId)
  if (charge.currency !== 'CAD') throw terminal()
  const resolved = await invoiceFromPaymentIntent(
    stripe,
    charge.paymentIntentId
  )
  const invoice = await invoiceContext(stripe, resolved.invoiceId, prices)
  if (resolved.customerId && resolved.customerId !== invoice.customerId)
    throw terminal()
  const status =
    event.eventType === 'charge.dispute.funds_withdrawn'
      ? 'funds_withdrawn'
      : event.eventType === 'charge.dispute.funds_reinstated'
      ? 'funds_reinstated'
      : text(dispute, 'status') || 'unknown'
  return {
    sourceObjectId: validateId(event.objectId || null, /^dp_[A-Za-z0-9]+$/),
    reversalId: disputeId,
    reversalType: 'dispute',
    sourceStatus: status,
    customerId: invoice.customerId,
    subscriptionId: invoice.subscriptionId,
    invoiceId: resolved.invoiceId,
    amountCents: disputeAmount,
    currency: 'CAD',
    classification: classifyDispute(
      event.eventType as ReversalEventType,
      status,
      disputeAmount,
      invoice
    ),
    providerVersion: eventVersion(event.providerCreatedAt),
  }
}

async function invoiceReversalValue(
  stripe: Stripe,
  event: ClaimedReversalEvent,
  prices: Record<'plus' | 'pro', string>
): Promise<ReversalValue> {
  const invoiceId = validateId(event.objectId || null, /^in_[A-Za-z0-9]+$/)
  const invoice = await invoiceContext(stripe, invoiceId, prices)
  const sourceStatus =
    event.eventType === 'invoice.voided' ? 'void' : 'uncollectible'
  return {
    sourceObjectId: invoiceId,
    reversalId: invoiceId,
    reversalType: 'invoice_reversal',
    sourceStatus,
    customerId: invoice.customerId,
    subscriptionId: invoice.subscriptionId,
    invoiceId,
    amountCents: invoice.paid,
    currency: 'CAD',
    classification: 'observed',
    providerVersion: eventVersion(event.providerCreatedAt),
  }
}

export function isShopBillingReversalEvent(value: string) {
  return (shopBillingReversalEventTypes as readonly string[]).includes(value)
}

/**
 * Re-fetches provider objects and records a trusted reversal fact. It never
 * invokes Membership RPCs or changes Provider Terms.
 */
export async function reconcileShopBillingReversal(
  event: ClaimedReversalEvent
): Promise<ShopBillingReversalReconciliationResult> {
  const config = shopBillingReversalReconciliationConfiguration()
  if (!event.eventId || !event.lease || !event.objectId || !event.eventType)
    throw terminal()
  if (!isShopBillingReversalEvent(event.eventType)) throw terminal()
  const runtime = await stripeRuntime()
  let value: ReversalValue
  if (
    event.eventType === 'refund.created' ||
    event.eventType === 'refund.updated'
  )
    value = await refundValue(runtime.stripe, event, config.prices)
  else if (event.eventType === 'charge.refunded')
    value = await chargeRefundValue(runtime.stripe, event, config.prices)
  else if (event.eventType.startsWith('charge.dispute.'))
    value = await disputeValue(runtime.stripe, event, config.prices)
  else value = await invoiceReversalValue(runtime.stripe, event, config.prices)

  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_reconcile_reversal',
    {
      p_platform: config.platform,
      p_event_id: event.eventId,
      p_lease: event.lease,
      p_value: value,
    }
  )
  if (error) {
    if (['23514', '23505', '40001'].includes(error.code || '')) throw terminal()
    throw unavailable()
  }
  const result =
    data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  return {
    reversalProofId:
      typeof result?.reversalProofId === 'string'
        ? result.reversalProofId
        : undefined,
    proofEligible: result?.proofEligible === true,
    reversalStateId:
      typeof result?.reversalStateId === 'string'
        ? result.reversalStateId
        : undefined,
    classification:
      result?.state === 'verified_full_reversal' ||
      result?.state === 'manual_review' ||
      result?.state === 'observed'
        ? result.state
        : undefined,
  }
}
