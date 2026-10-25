// Server-only B22 consumer. Signed events are notices; Stripe retrieval is proof.
import { randomUUID } from 'crypto'

import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { prepareOrderPaymentConfirmation } from '@/lib/server/stripe-order-payment'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

export const orderPaymentEventTypes = [
  'payment_intent.succeeded',
  'payment_intent.payment_failed',
  'payment_intent.processing',
  'payment_intent.canceled',
] as const

type Claim =
  | {
      claimKind: 'due'
      attemptId: string
      providerReference: string
      lease: string
    }
  | {
      claimKind: 'event'
      eventId: string
      eventType: string
      providerReference: string
      lease: string
    }
  | { claimKind: 'unbound'; attemptId: string; buyerId: string }

type ApplyResult = {
  result: 'applied' | 'duplicate' | 'exception' | 'pending'
  attemptId: string
  orderId: string
  providerStatus: string
  exceptionCode: string | null
}

function providerId(value: string | { id: string } | null) {
  return typeof value === 'string' ? value : value?.id || null
}

async function rpc<T>(
  action: string,
  platform: string,
  token: string | null = null,
  value: Record<string, unknown> = {}
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_payment_reconciliation',
    {
      p_action: action,
      p_platform: platform,
      p_token: token,
      p_value: value,
    }
  )
  if (error)
    throw new ListingApiError('Order payment reconciliation failed.', 503)
  return data as T | null
}

export async function enqueueStripeOrderPaymentEvent({
  eventId,
  eventType,
  paymentIntentId,
}: {
  eventId: string
  eventType: typeof orderPaymentEventTypes[number]
  paymentIntentId: string
}) {
  const { config } = await stripeRuntime()
  await rpc('enqueue', config.platform, null, {
    id: eventId,
    type: eventType,
    scope: config.platform,
    providerReference: paymentIntentId,
  })
}

function observation(
  intent: Stripe.PaymentIntent,
  attemptId: string,
  evidenceId: string
) {
  return {
    evidenceId,
    attemptId,
    providerReference: intent.id,
    providerStatus: intent.status,
    livemode: intent.livemode,
    amount: intent.amount,
    amountReceived: intent.amount_received,
    currency: intent.currency,
    customer: providerId(intent.customer),
    paymentMethod: providerId(intent.payment_method),
    sellerAccount: providerId(intent.on_behalf_of),
    transferGroup: intent.transfer_group,
    orderId: intent.metadata.uu_order || null,
    metadataAttempt: intent.metadata.uu_attempt || null,
    metadataKind: intent.metadata.uu_kind || null,
    metadataEnvironment: intent.metadata.uu_environment || null,
  }
}

async function retrieveAndApply(
  stripe: Stripe,
  platform: string,
  claim: Extract<Claim, { claimKind: 'due' | 'event' }>
) {
  const intent = await stripe.paymentIntents.retrieve(claim.providerReference)
  const evidenceId =
    claim.claimKind === 'event' ? claim.eventId : `reconcile:${randomUUID()}`
  const attemptId =
    claim.claimKind === 'due'
      ? claim.attemptId
      : intent.metadata.uu_attempt || ''
  return rpc<ApplyResult>(
    claim.claimKind === 'event' ? 'apply_event' : 'apply_due',
    platform,
    claim.lease,
    observation(intent, attemptId, evidenceId)
  )
}

function retryClaim(
  platform: string,
  claim: Extract<Claim, { claimKind: 'due' | 'event' }>
) {
  return claim.claimKind === 'event'
    ? rpc('retry_event', platform, claim.lease, {
        eventId: claim.eventId,
      })
    : rpc('retry_due', platform, claim.lease, {
        attemptId: claim.attemptId,
      })
}

export async function drainStripeOrderPayments(limit = 20) {
  const bounded = Math.max(1, Math.min(limit, 20))
  if (process.env.STRIPE_ORDER_PAYMENTS_ENABLED !== 'true')
    return {
      enabled: false,
      processed: 0,
      recovered: 0,
      pending: 0,
      exceptions: 0,
    }
  const { config, stripe } = await stripeRuntime()
  let processed = 0
  let exceptions = 0
  let pending = 0
  let recovered = 0

  for (let index = 0; index < bounded; index++) {
    const event = await rpc<Extract<Claim, { claimKind: 'event' }>>(
      'claim_event',
      config.platform
    )
    if (!event) break
    try {
      const result = await retrieveAndApply(stripe, config.platform, event)
      processed++
      if (result?.result === 'exception') exceptions++
      if (result?.result === 'pending') pending++
    } catch {
      await retryClaim(config.platform, event)
    }
  }

  for (let index = 0; index < bounded; index++) {
    const unbound = await rpc<Extract<Claim, { claimKind: 'unbound' }>>(
      'claim_unbound',
      config.platform
    )
    if (!unbound) break
    try {
      await prepareOrderPaymentConfirmation(unbound.attemptId, unbound.buyerId)
      recovered++
    } catch {
      // The claim schedules a bounded retry. B21 retains the same attempt/key.
    }
  }

  for (let index = 0; index < bounded; index++) {
    const due = await rpc<Extract<Claim, { claimKind: 'due' }>>(
      'claim_due',
      config.platform
    )
    if (!due) break
    try {
      const result = await retrieveAndApply(stripe, config.platform, due)
      processed++
      if (result?.result === 'exception') exceptions++
      if (result?.result === 'pending') pending++
    } catch {
      await retryClaim(config.platform, due)
    }
  }
  return { enabled: true, processed, recovered, pending, exceptions }
}
