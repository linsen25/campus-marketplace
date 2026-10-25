// Server-only B25-A Stripe payment-dispute observer. No evidence submission,
// dispute closure, refund, transfer reversal or liability decision exists here.
import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

export const orderDisputeEventTypes = [
  'charge.dispute.created',
  'charge.dispute.updated',
  'charge.dispute.closed',
  'charge.dispute.funds_withdrawn',
  'charge.dispute.funds_reinstated',
] as const
type DisputeEventType = typeof orderDisputeEventTypes[number]
type Claim = {
  eventId: string
  eventType: DisputeEventType
  providerReference: string
  lease: string
}
class DisputeValidationError extends Error {}

function enabled() {
  return process.env.STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED === 'true'
}
function id(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id || null
}
async function rpc<T>(
  action: 'apply' | 'claim' | 'done_mismatch' | 'enqueue' | 'retry',
  platform: string,
  token: string | null = null,
  value: Record<string, unknown> = {}
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_stripe_dispute_events',
    { p_action: action, p_platform: platform, p_token: token, p_value: value }
  )
  if (error)
    throw new ListingApiError('Stripe Dispute reconciliation failed.', 503)
  return data as T | null
}

export async function enqueueStripeOrderDisputeEvent(value: {
  disputeId: string
  eventId: string
  eventType: DisputeEventType
}) {
  if (!enabled()) return false
  const { config } = await stripeRuntime()
  await rpc('enqueue', config.platform, null, {
    id: value.eventId,
    providerReference: value.disputeId,
    scope: config.platform,
    type: value.eventType,
  })
  return true
}

function timestamp(value: number | null, field: string) {
  if (value === null) return ''
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new DisputeValidationError(`Invalid ${field}.`)
  return new Date(value * 1000).toISOString()
}

function validate(
  dispute: Stripe.Dispute,
  charge: Stripe.Charge,
  intent: Stripe.PaymentIntent,
  claim: Claim
) {
  const chargeRef = id(dispute.charge)
  const intentRef = id(dispute.payment_intent)
  if (
    dispute.id !== claim.providerReference ||
    !/^du_[A-Za-z0-9]+$/.test(dispute.id) ||
    dispute.livemode ||
    !chargeRef?.match(/^ch_[A-Za-z0-9]+$/) ||
    !intentRef?.match(/^pi_[A-Za-z0-9]+$/) ||
    charge.id !== chargeRef ||
    charge.livemode ||
    id(charge.payment_intent) !== intentRef ||
    intent.id !== intentRef ||
    intent.livemode ||
    intent.metadata.uu_kind !== 'marketplace_order' ||
    intent.metadata.uu_environment !== 'staging' ||
    dispute.currency !== 'cad' ||
    charge.currency !== 'cad' ||
    intent.currency !== 'cad' ||
    !Number.isSafeInteger(dispute.amount) ||
    dispute.amount <= 0 ||
    dispute.amount > charge.amount ||
    !Number.isSafeInteger(charge.amount) ||
    !Number.isSafeInteger(charge.amount_refunded) ||
    charge.amount_refunded < 0 ||
    charge.amount_refunded > charge.amount ||
    ![
      'warning_needs_response',
      'warning_under_review',
      'warning_closed',
      'needs_response',
      'under_review',
      'won',
      'lost',
      'prevented',
    ].includes(dispute.status) ||
    !/^[a-z0-9_]{1,80}$/.test(dispute.reason) ||
    !Number.isSafeInteger(dispute.evidence_details.submission_count) ||
    dispute.evidence_details.submission_count < 0
  )
    throw new DisputeValidationError('Stripe Dispute binding mismatch.')
  let withdrawn = 0
  let reinstated = 0
  const balances = dispute.balance_transactions.map((entry) => {
    if (
      !/^txn_[A-Za-z0-9]+$/.test(entry.id) ||
      entry.currency !== 'cad' ||
      id(entry.source) !== dispute.id ||
      !Number.isSafeInteger(entry.amount)
    )
      throw new DisputeValidationError(
        'Stripe Dispute balance evidence mismatch.'
      )
    if (entry.amount < 0) withdrawn += Math.abs(entry.amount)
    else reinstated += entry.amount
    return {
      amount: entry.amount,
      id: entry.id,
      reportingCategory: entry.reporting_category,
      status: entry.status,
      type: entry.type,
    }
  })
  if (balances.length > 4 || !Number.isSafeInteger(withdrawn + reinstated))
    throw new DisputeValidationError(
      'Stripe Dispute balance evidence overflow.'
    )
  return {
    amount: String(dispute.amount),
    balanceTransactions: balances,
    chargeAmount: String(charge.amount),
    chargeRef,
    chargeRefunded: String(charge.amount_refunded),
    currency: dispute.currency,
    disputeRef: dispute.id,
    eventId: claim.eventId,
    eventType: claim.eventType,
    evidencePastDue: dispute.evidence_details.past_due,
    evidenceSubmissionCount: dispute.evidence_details.submission_count,
    fundsReinstated: String(reinstated),
    fundsWithdrawn: String(withdrawn),
    hasEvidence: dispute.evidence_details.has_evidence,
    metadataAttempt: intent.metadata.uu_attempt || '',
    metadataOrder: intent.metadata.uu_order || '',
    observedAt: new Date().toISOString(),
    paymentIntentRef: intent.id,
    providerCreatedAt: timestamp(dispute.created, 'creation time'),
    providerStatus: dispute.status,
    reason: dispute.reason,
    responseDueAt: timestamp(
      dispute.evidence_details.due_by,
      'response deadline'
    ),
  }
}

async function reconcile(stripe: Stripe, platform: string, claim: Claim) {
  try {
    if (
      !/^evt_[A-Za-z0-9]+$/.test(claim.eventId) ||
      !/^[0-9a-f-]{36}$/i.test(claim.lease)
    )
      throw new DisputeValidationError('Invalid Stripe Dispute claim.')
    const dispute = await stripe.disputes.retrieve(claim.providerReference)
    const chargeRef = id(dispute.charge)
    const intentRef = id(dispute.payment_intent)
    if (!chargeRef || !intentRef)
      throw new DisputeValidationError('Stripe Dispute source missing.')
    const [charge, intent] = await Promise.all([
      stripe.charges.retrieve(chargeRef),
      stripe.paymentIntents.retrieve(intentRef),
    ])
    const result = await rpc<{ result?: string }>(
      'apply',
      platform,
      claim.lease,
      validate(dispute, charge, intent, claim)
    )
    return result?.result === 'mismatch' ? 'mismatch' : 'processed'
  } catch (error) {
    if (error instanceof DisputeValidationError) {
      await rpc('done_mismatch', platform, claim.lease, {
        eventId: claim.eventId,
      })
      return 'mismatch'
    }
    await rpc('retry', platform, claim.lease, { eventId: claim.eventId })
    return 'retried'
  }
}

export async function drainStripeOrderDisputes(limit = 10) {
  if (!enabled())
    return { enabled: false, processed: 0, retried: 0, mismatches: 0 }
  const { config, stripe } = await stripeRuntime()
  let processed = 0
  let retried = 0
  let mismatches = 0
  for (let index = 0; index < Math.max(1, Math.min(limit, 20)); index++) {
    const claim = await rpc<Claim>('claim', config.platform)
    if (!claim) break
    const result = await reconcile(stripe, config.platform, claim)
    if (result === 'processed') processed++
    else if (result === 'retried') retried++
    else mismatches++
  }
  return { enabled: true, processed, retried, mismatches }
}
