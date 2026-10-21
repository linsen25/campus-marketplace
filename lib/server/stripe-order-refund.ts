// Server-only B23-B Stripe Refund executor. No browser or webhook entry point.
import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

export type ClaimedOrderRefund = {
  id: string
  order_id: string
  payment_attempt_id: string
  provider: 'stripe'
  provider_mode: 'test'
  provider_platform: string
  payment_intent_ref: string
  amount_cents: number
  currency: 'CAD'
  operation_id: string
  idempotency_key: string
  refund_ref: string | null
  state: 'in_flight' | 'reconciling'
  request_started_at: string
  lease: string
  lease_until: string
  attempts: number
  claim_kind: 'execute' | 'reconcile'
  provider_customer_ref: string
  provider_instrument_ref: string
  provider_seller_account_ref: string
  provider_transfer_group: string
  provider_amount_cents: number
  provider_currency: 'CAD'
}

export const orderRefundEventTypes = [
  'refund.created',
  'refund.updated',
  'refund.failed',
] as const

type RefundEventClaim = {
  eventId: string
  eventType: string
  providerReference: string
  lease: string
}

type RefundResult = ClaimedOrderRefund & {
  result: 'applied' | 'deferred' | 'duplicate' | 'exception' | 'pending'
  provider_status: string | null
  last_error_code: string | null
}

class ProviderValidationError extends Error {
  constructor(message: string, readonly kind: 'binding' | 'uncertain') {
    super(message)
  }
}

function providerId(value: string | { id: string } | null) {
  return typeof value === 'string' ? value : value?.id || null
}

export function assertStripeOrderRefundsEnabled() {
  if (process.env.STRIPE_ORDER_REFUNDS_ENABLED !== 'true')
    throw new ListingApiError(
      'Order refunds are awaiting final verification.',
      503
    )
}

async function rpc<T>(
  action: 'apply' | 'defer',
  claim: ClaimedOrderRefund,
  value: Record<string, unknown>
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_refund_result',
    {
      p_action: action,
      p_order: claim.order_id,
      p_platform: claim.provider_platform,
      p_token: claim.lease,
      p_value: value,
    }
  )
  if (error) throw new ListingApiError('Refund reconciliation failed.', 503)
  return data as T
}

async function claimDue(platform: string) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_refund_operation',
    {
      p_action: 'claim_due',
      p_order: null,
      p_platform: platform,
      p_token: null,
    }
  )
  if (error) throw new ListingApiError('Refund claim failed.', 503)
  return data as ClaimedOrderRefund | null
}

async function refundEventRpc<T>(
  action: 'claim' | 'done_mismatch' | 'done' | 'enqueue' | 'retry',
  platform: string,
  token: string | null = null,
  value: Record<string, unknown> = {}
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_refund_events',
    { p_action: action, p_platform: platform, p_token: token, p_value: value }
  )
  if (error)
    throw new ListingApiError('Refund event reconciliation failed.', 503)
  return data as T | null
}

export async function enqueueStripeOrderRefundEvent({
  eventId,
  eventType,
  refundId,
}: {
  eventId: string
  eventType: typeof orderRefundEventTypes[number]
  refundId: string
}) {
  const { config } = await stripeRuntime()
  await refundEventRpc('enqueue', config.platform, null, {
    id: eventId,
    type: eventType,
    scope: config.platform,
    providerReference: refundId,
  })
}

async function readPreparedRefund(orderId: string, platform: string) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_refund_operation',
    {
      p_action: 'read',
      p_order: orderId,
      p_platform: platform,
      p_token: null,
    }
  )
  if (error) throw new ListingApiError('Refund operation read failed.', 503)
  return data as ClaimedOrderRefund | null
}

async function prepareRefund(orderId: string, platform: string) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_refund_operation',
    {
      p_action: 'prepare',
      p_order: orderId,
      p_platform: platform,
      p_token: null,
    }
  )
  if (error) throw new ListingApiError('Refund preparation failed.', 503)
  return data as (ClaimedOrderRefund & { required: boolean }) | null
}

function assertClaim(claim: ClaimedOrderRefund, platform: string) {
  if (
    claim.provider !== 'stripe' ||
    claim.provider_mode !== 'test' ||
    claim.provider_platform !== platform ||
    !/^pi_[A-Za-z0-9]+$/.test(claim.payment_intent_ref) ||
    !/^[0-9a-f-]{36}$/i.test(claim.operation_id) ||
    !/^[0-9a-f-]{36}$/i.test(claim.lease) ||
    claim.currency !== 'CAD' ||
    claim.provider_currency !== 'CAD' ||
    !Number.isSafeInteger(Number(claim.amount_cents)) ||
    Number(claim.amount_cents) <= 0 ||
    !Number.isSafeInteger(Number(claim.provider_amount_cents)) ||
    Number(claim.amount_cents) > Number(claim.provider_amount_cents) ||
    !['execute', 'reconcile'].includes(claim.claim_kind)
  )
    throw new ProviderValidationError('Invalid refund claim.', 'binding')
}

function validatePaymentIntent(
  intent: Stripe.PaymentIntent,
  claim: ClaimedOrderRefund
) {
  if (
    intent.id !== claim.payment_intent_ref ||
    intent.livemode ||
    intent.status !== 'succeeded' ||
    intent.amount !== Number(claim.provider_amount_cents) ||
    intent.amount_received !== Number(claim.provider_amount_cents) ||
    intent.currency !== 'cad' ||
    providerId(intent.customer) !== claim.provider_customer_ref ||
    providerId(intent.payment_method) !== claim.provider_instrument_ref ||
    providerId(intent.on_behalf_of) !== claim.provider_seller_account_ref ||
    intent.transfer_group !== claim.provider_transfer_group ||
    intent.metadata.uu_kind !== 'marketplace_order' ||
    intent.metadata.uu_order !== claim.order_id ||
    intent.metadata.uu_attempt !== claim.payment_attempt_id ||
    intent.metadata.uu_environment !== 'staging'
  )
    throw new ProviderValidationError(
      'Original payment binding mismatch.',
      'binding'
    )
}

function matchingRefund(refunds: Stripe.Refund[], claim: ClaimedOrderRefund) {
  const matching = refunds.filter(
    (refund) => refund.metadata?.uu_operation === claim.operation_id
  )
  const unrelated = refunds.filter(
    (refund) => refund.metadata?.uu_operation !== claim.operation_id
  )
  if (matching.length > 1 || unrelated.length > 0)
    throw new ProviderValidationError('Conflicting refund exists.', 'binding')
  return matching[0] || null
}

async function listAllRefunds(
  stripe: Stripe,
  paymentIntent: string
): Promise<Stripe.Refund[]> {
  const refunds: Stripe.Refund[] = []
  let startingAfter: string | undefined
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await stripe.refunds.list({
      payment_intent: paymentIntent,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    refunds.push(...page.data)
    if (!page.has_more) return refunds
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter)
      throw new ProviderValidationError(
        'Incomplete refund pagination.',
        'uncertain'
      )
  }
  throw new ProviderValidationError(
    'Refund pagination limit reached.',
    'uncertain'
  )
}

function validateRefund(refund: Stripe.Refund, claim: ClaimedOrderRefund) {
  const status = refund.status
  const metadata = refund.metadata || {}
  if (
    !/^re_[A-Za-z0-9]+$/.test(refund.id) ||
    (claim.refund_ref !== null && refund.id !== claim.refund_ref) ||
    providerId(refund.payment_intent) !== claim.payment_intent_ref ||
    refund.amount !== Number(claim.amount_cents) ||
    refund.currency !== 'cad' ||
    !status ||
    !['pending', 'requires_action', 'succeeded', 'failed', 'canceled'].includes(
      status
    ) ||
    metadata.uu_kind !== 'marketplace_order_refund' ||
    metadata.uu_order !== claim.order_id ||
    metadata.uu_attempt !== claim.payment_attempt_id ||
    metadata.uu_operation !== claim.operation_id ||
    metadata.uu_environment !== 'staging'
  )
    throw new ProviderValidationError('Refund binding mismatch.', 'binding')
  return status
}

function observation(refund: Stripe.Refund, claim: ClaimedOrderRefund) {
  const metadata = refund.metadata || {}
  return {
    amount: String(refund.amount),
    currency: refund.currency,
    livemode: false,
    metadataAttempt: metadata.uu_attempt || null,
    metadataEnvironment: metadata.uu_environment || null,
    metadataKind: metadata.uu_kind || null,
    metadataOperation: metadata.uu_operation || null,
    metadataOrder: metadata.uu_order || null,
    operationId: claim.operation_id,
    paymentIntentRef: providerId(refund.payment_intent),
    providerMode: claim.provider_mode,
    providerPlatform: claim.provider_platform,
    providerStatus: refund.status,
    refundRef: refund.id,
  }
}

function defer(
  claim: ClaimedOrderRefund,
  errorCode: 'provider_mismatch' | 'provider_unavailable' | 'unknown_outcome'
) {
  return rpc<RefundResult>('defer', claim, { errorCode })
}

export async function processClaimedOrderRefund(claim: ClaimedOrderRefund) {
  assertStripeOrderRefundsEnabled()
  const { config, stripe } = await stripeRuntime()
  try {
    assertClaim(claim, config.platform)
    const intent = await stripe.paymentIntents.retrieve(
      claim.payment_intent_ref
    )
    validatePaymentIntent(intent, claim)

    let refund: Stripe.Refund | null = null
    if (claim.refund_ref) {
      refund = await stripe.refunds.retrieve(claim.refund_ref)
    } else {
      refund = matchingRefund(
        await listAllRefunds(stripe, claim.payment_intent_ref),
        claim
      )
    }

    if (!refund && claim.claim_kind === 'reconcile')
      return defer(claim, 'unknown_outcome')

    if (!refund) {
      let createStarted = false
      try {
        createStarted = true
        refund = await stripe.refunds.create(
          {
            payment_intent: claim.payment_intent_ref,
            amount: Number(claim.amount_cents),
            reason: 'requested_by_customer',
            metadata: {
              uu_kind: 'marketplace_order_refund',
              uu_order: claim.order_id,
              uu_attempt: claim.payment_attempt_id,
              uu_operation: claim.operation_id,
              uu_environment: 'staging',
            },
          },
          { idempotencyKey: claim.idempotency_key }
        )
      } catch {
        return defer(
          claim,
          createStarted ? 'unknown_outcome' : 'provider_unavailable'
        )
      }
    }

    validateRefund(refund, claim)
    return rpc<RefundResult>('apply', claim, observation(refund, claim))
  } catch (error) {
    if (error instanceof ProviderValidationError)
      return defer(
        claim,
        error.kind === 'binding' ? 'provider_mismatch' : 'unknown_outcome'
      )
    return defer(claim, 'provider_unavailable')
  }
}

export async function drainStripeOrderRefunds(limit = 10) {
  assertStripeOrderRefundsEnabled()
  const bounded = Math.max(1, Math.min(limit, 10))
  const { config } = await stripeRuntime()
  let processed = 0
  let pending = 0
  let exceptions = 0
  for (let index = 0; index < bounded; index++) {
    const claim = await claimDue(config.platform)
    if (!claim) break
    const result = await processClaimedOrderRefund(claim)
    processed++
    if (result.result === 'pending' || result.result === 'deferred') pending++
    if (result.result === 'exception') exceptions++
  }
  return { processed, pending, exceptions }
}

function refundEventObservation(refund: Stripe.Refund) {
  const metadata = refund.metadata || {}
  const paymentIntent = providerId(refund.payment_intent)
  if (
    !/^re_[A-Za-z0-9]+$/.test(refund.id) ||
    !paymentIntent?.match(/^pi_[A-Za-z0-9]+$/) ||
    !Number.isSafeInteger(refund.amount) ||
    refund.amount <= 0 ||
    refund.currency !== 'cad' ||
    metadata.uu_kind !== 'marketplace_order_refund' ||
    !/^[0-9a-f-]{36}$/i.test(metadata.uu_order || '') ||
    !/^[0-9a-f-]{36}$/i.test(metadata.uu_operation || '') ||
    metadata.uu_environment !== 'staging'
  )
    throw new ProviderValidationError(
      'Refund event binding mismatch.',
      'binding'
    )
  return {
    amount: String(refund.amount),
    currency: refund.currency,
    metadataOperation: metadata.uu_operation,
    metadataOrder: metadata.uu_order,
    paymentIntentRef: paymentIntent,
    refundRef: refund.id,
  }
}

export async function drainStripeOrderRefundEvents(limit = 10) {
  assertStripeOrderRefundsEnabled()
  const bounded = Math.max(1, Math.min(limit, 10))
  const { config, stripe } = await stripeRuntime()
  let processed = 0
  let retried = 0
  let mismatches = 0
  for (let index = 0; index < bounded; index++) {
    const claim = await refundEventRpc<RefundEventClaim>(
      'claim',
      config.platform
    )
    if (!claim) break
    try {
      const refund = await stripe.refunds.retrieve(claim.providerReference)
      const value = refundEventObservation(refund)
      const operation = await readPreparedRefund(
        value.metadataOrder,
        config.platform
      )
      if (!operation) {
        await refundEventRpc('retry', config.platform, claim.lease, {
          eventId: claim.eventId,
          reason: 'operation_unavailable',
        })
        retried++
      } else {
        if (
          operation.operation_id !== value.metadataOperation ||
          operation.order_id !== value.metadataOrder ||
          operation.payment_intent_ref !== value.paymentIntentRef ||
          Number(operation.amount_cents) !== Number(value.amount) ||
          operation.currency.toLowerCase() !== value.currency ||
          (operation.refund_ref !== null &&
            operation.refund_ref !== value.refundRef)
        )
          throw new ProviderValidationError(
            'Refund event operation mismatch.',
            'binding'
          )
        await refundEventRpc('done', config.platform, claim.lease, {
          eventId: claim.eventId,
          ...value,
        })
        processed++
      }
    } catch (error) {
      if (
        error instanceof ProviderValidationError &&
        error.kind === 'binding'
      ) {
        await refundEventRpc('done_mismatch', config.platform, claim.lease, {
          eventId: claim.eventId,
        })
        mismatches++
      } else {
        await refundEventRpc('retry', config.platform, claim.lease, {
          eventId: claim.eventId,
          reason: 'provider_unavailable',
        })
        retried++
      }
    }
  }
  return { processed, retried, mismatches }
}

export async function prepareAuthorizedOrderRefunds(limit = 10) {
  assertStripeOrderRefundsEnabled()
  const bounded = Math.max(1, Math.min(limit, 20))
  const { config } = await stripeRuntime()
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_refund_candidates',
    { p_platform: config.platform, p_limit: bounded }
  )
  if (error) throw new ListingApiError('Refund discovery failed.', 503)
  let prepared = 0
  let skipped = 0
  for (const candidate of (data || []) as Array<{ order_id: string }>) {
    try {
      const result = await prepareRefund(candidate.order_id, config.platform)
      if (result?.required) prepared++
      else skipped++
    } catch {
      // Discovery is a hint. The authoritative prepare RPC rejects stale rows;
      // continue the bounded batch so one invalid candidate cannot starve it.
      skipped++
    }
  }
  return { prepared, skipped }
}

export async function drainStripeOrderRefundWork(limit = 10) {
  if (process.env.STRIPE_ORDER_REFUNDS_ENABLED !== 'true')
    return {
      enabled: false,
      events: { processed: 0, retried: 0, mismatches: 0 },
      discovery: { prepared: 0, skipped: 0 },
      refunds: { processed: 0, pending: 0, exceptions: 0 },
    }
  const events = await drainStripeOrderRefundEvents(limit)
  const discovery = await prepareAuthorizedOrderRefunds(limit)
  const refunds = await drainStripeOrderRefunds(limit)
  return { enabled: true, events, discovery, refunds }
}
