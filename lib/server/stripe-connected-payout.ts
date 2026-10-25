// Server-only B24-C observer. It retrieves connected-account Payout facts and
// never creates, cancels, reverses or assigns a bank Payout to an Order.
import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

export const connectedPayoutEventTypes = [
  'payout.created',
  'payout.updated',
  'payout.paid',
  'payout.failed',
  'payout.canceled',
  'payout.reconciliation_completed',
] as const

type ConnectedPayoutEventType = typeof connectedPayoutEventTypes[number]

type PayoutEventClaim = {
  eventId: string
  eventType: ConnectedPayoutEventType
  providerReference: string
  connectedAccount: string
  lease: string
}

class PayoutValidationError extends Error {}

function observationEnabled() {
  return process.env.STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED === 'true'
}

function providerId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id || null
}

async function eventRpc<T>(
  action: 'apply' | 'claim' | 'done_mismatch' | 'enqueue' | 'retry',
  platform: string,
  token: string | null = null,
  value: Record<string, unknown> = {}
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_connected_payout_events',
    { p_action: action, p_platform: platform, p_token: token, p_value: value }
  )
  if (error)
    throw new ListingApiError('Connected Payout reconciliation failed.', 503)
  return data as T | null
}

export async function enqueueStripeConnectedPayoutEvent({
  connectedAccount,
  eventId,
  eventType,
  payoutId,
}: {
  connectedAccount: string
  eventId: string
  eventType: ConnectedPayoutEventType
  payoutId: string
}) {
  if (!observationEnabled()) return false
  const { config } = await stripeRuntime()
  await eventRpc('enqueue', config.platform, null, {
    id: eventId,
    providerReference: payoutId,
    scope: connectedAccount,
    type: eventType,
  })
  return true
}

function timestamp(value: number, name: string) {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new PayoutValidationError(`Invalid ${name}.`)
  return new Date(value * 1000).toISOString()
}

function validatePayout(
  payout: Stripe.Payout,
  claim: PayoutEventClaim,
  platform: string
) {
  if (
    !/^acct_[A-Za-z0-9]+$/.test(platform) ||
    !/^acct_[A-Za-z0-9]+$/.test(claim.connectedAccount) ||
    claim.connectedAccount === platform ||
    payout.id !== claim.providerReference ||
    !/^po_[A-Za-z0-9]+$/.test(payout.id) ||
    payout.livemode ||
    !Number.isSafeInteger(payout.amount) ||
    payout.amount <= 0 ||
    payout.amount > 99999999 ||
    payout.currency !== 'cad' ||
    !['standard', 'instant'].includes(payout.method) ||
    !['pending', 'in_transit', 'paid', 'failed', 'canceled'].includes(
      payout.status
    ) ||
    !['not_applicable', 'in_progress', 'completed'].includes(
      payout.reconciliation_status
    )
  )
    throw new PayoutValidationError('Connected Payout binding mismatch.')
  const balanceTransaction = providerId(payout.balance_transaction)
  const failureBalanceTransaction = providerId(
    payout.failure_balance_transaction
  )
  if (
    (balanceTransaction && !/^txn_[A-Za-z0-9]+$/.test(balanceTransaction)) ||
    (failureBalanceTransaction &&
      !/^txn_[A-Za-z0-9]+$/.test(failureBalanceTransaction)) ||
    (payout.failure_code &&
      (!/^[a-z0-9_]+$/.test(payout.failure_code) ||
        payout.failure_code.length > 100))
  )
    throw new PayoutValidationError('Connected Payout evidence mismatch.')
  return {
    amount: String(payout.amount),
    arrivalAt: timestamp(payout.arrival_date, 'arrival date'),
    // A balance transaction reference permits later provider-led research; it
    // does not prove which UU Transfers funded this account-level Payout.
    attributionStatus: balanceTransaction ? 'unattributed' : 'unknown',
    automatic: payout.automatic,
    balanceTransactionRef: balanceTransaction || '',
    connectedAccount: claim.connectedAccount,
    currency: payout.currency,
    eventId: claim.eventId,
    eventType: claim.eventType,
    failureBalanceTransactionRef: failureBalanceTransaction || '',
    failureCode: payout.failure_code || '',
    method: payout.method,
    observedAt: new Date().toISOString(),
    payoutRef: payout.id,
    providerCreatedAt: timestamp(payout.created, 'creation date'),
    providerStatus: payout.status,
    reconciliationStatus: payout.reconciliation_status,
  }
}

async function reconcileClaim(
  stripe: Stripe,
  platform: string,
  claim: PayoutEventClaim
) {
  try {
    if (
      !/^evt_[A-Za-z0-9]+$/.test(claim.eventId) ||
      !connectedPayoutEventTypes.includes(claim.eventType) ||
      !/^[0-9a-f-]{36}$/i.test(claim.lease)
    )
      throw new PayoutValidationError('Invalid connected Payout claim.')
    // Stripe-Account scopes the read to the account that emitted the signed
    // event. No destination or provider identity is accepted from a browser.
    const payout = await stripe.payouts.retrieve(
      claim.providerReference,
      {},
      { stripeAccount: claim.connectedAccount }
    )
    const applied = await eventRpc<{ result?: string }>(
      'apply',
      platform,
      claim.lease,
      validatePayout(payout, claim, platform)
    )
    return applied?.result === 'mismatch'
      ? ('mismatch' as const)
      : ('processed' as const)
  } catch (error) {
    if (error instanceof PayoutValidationError) {
      await eventRpc('done_mismatch', platform, claim.lease, {
        eventId: claim.eventId,
      })
      return 'mismatch' as const
    }
    await eventRpc('retry', platform, claim.lease, {
      eventId: claim.eventId,
    })
    return 'retried' as const
  }
}

export async function drainStripeConnectedPayoutObservations(limit = 10) {
  const bounded = Math.max(1, Math.min(limit, 20))
  if (!observationEnabled())
    return { enabled: false, processed: 0, retried: 0, mismatches: 0 }
  const { config, stripe } = await stripeRuntime()
  let processed = 0
  let retried = 0
  let mismatches = 0
  for (let index = 0; index < bounded; index++) {
    const claim = await eventRpc<PayoutEventClaim>('claim', config.platform)
    if (!claim) break
    const result = await reconcileClaim(stripe, config.platform, claim)
    if (result === 'processed') processed++
    else if (result === 'retried') retried++
    else mismatches++
  }
  return { enabled: true, processed, retried, mismatches }
}
