// Server-only B24-B Stripe Transfer executor. It never creates a bank Payout.
import { randomUUID } from 'crypto'

import type Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { stripeRuntime } from '@/lib/server/stripe-runtime'

export type ClaimedOrderTransfer = {
  id: string
  order_id: string
  payment_attempt_id: string
  seller_id: string
  transfer_kind: 'delivery_compensation' | 'sale_proceeds'
  provider: 'stripe'
  provider_mode: 'test'
  provider_platform: string
  payment_intent_ref: string
  destination_account_ref: string
  amount_cents: number
  currency: 'CAD'
  transfer_group: string
  operation_id: string
  idempotency_key: string
  transfer_ref: string | null
  source_charge_ref: string | null
  state: 'in_flight' | 'reconciling'
  lease: string
  claim_kind: 'execute' | 'reconcile'
}

export const orderTransferEventTypes = [
  'transfer.created',
  'transfer.updated',
  'transfer.reversed',
] as const

type TransferResult = ClaimedOrderTransfer & {
  result: 'applied' | 'deferred' | 'duplicate' | 'exception'
}

type TransferEventClaim = {
  eventId: string
  eventType: string
  providerReference: string
  lease: string
}

class ProviderValidationError extends Error {
  constructor(message: string, readonly kind: 'binding' | 'recipient') {
    super(message)
  }
}

function providerId(value: string | { id: string } | null | undefined) {
  return typeof value === 'string' ? value : value?.id || null
}

function assertTransferWorkEnabled() {
  if (
    process.env.STRIPE_ORDER_TRANSFERS_ENABLED !== 'true' ||
    process.env.STRIPE_ORDER_TRANSFERS_CREATE_APPROVED !== 'true'
  )
    throw new ListingApiError(
      'Seller transfers are awaiting financial approval.',
      503
    )
}

async function operationRpc<T>(
  action: 'apply' | 'defer',
  claim: ClaimedOrderTransfer,
  value: Record<string, unknown>
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_transfer_result',
    {
      p_action: action,
      p_order: claim.order_id,
      p_platform: claim.provider_platform,
      p_token: claim.lease,
      p_value: value,
    }
  )
  if (error) throw new ListingApiError('Transfer reconciliation failed.', 503)
  return data as T
}

async function claimDue(platform: string) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_transfer_operation',
    {
      p_action: 'claim_due',
      p_order: null,
      p_platform: platform,
      p_token: null,
    }
  )
  if (error) throw new ListingApiError('Transfer claim failed.', 503)
  return data as ClaimedOrderTransfer | null
}

async function prepareTransfer(orderId: string, platform: string) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_transfer_operation',
    {
      p_action: 'prepare',
      p_order: orderId,
      p_platform: platform,
      p_token: null,
    }
  )
  if (error) throw new ListingApiError('Transfer preparation failed.', 503)
  return data as ClaimedOrderTransfer | null
}

async function readTransfer(orderId: string, platform: string) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_transfer_operation',
    {
      p_action: 'read',
      p_order: orderId,
      p_platform: platform,
      p_token: null,
    }
  )
  if (error) throw new ListingApiError('Transfer operation read failed.', 503)
  return data as ClaimedOrderTransfer | null
}

async function eventRpc<T>(
  action: 'claim' | 'done' | 'done_mismatch' | 'enqueue' | 'retry',
  platform: string,
  token: string | null = null,
  value: Record<string, unknown> = {}
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_transfer_events',
    { p_action: action, p_platform: platform, p_token: token, p_value: value }
  )
  if (error)
    throw new ListingApiError('Transfer event reconciliation failed.', 503)
  return data as T | null
}

export async function enqueueStripeOrderTransferEvent({
  eventId,
  eventType,
  transferId,
}: {
  eventId: string
  eventType: typeof orderTransferEventTypes[number]
  transferId: string
}) {
  const { config } = await stripeRuntime()
  await eventRpc('enqueue', config.platform, null, {
    id: eventId,
    type: eventType,
    scope: config.platform,
    providerReference: transferId,
  })
}

function assertClaim(claim: ClaimedOrderTransfer, platform: string) {
  if (
    claim.provider !== 'stripe' ||
    claim.provider_mode !== 'test' ||
    claim.provider_platform !== platform ||
    !/^pi_[A-Za-z0-9]+$/.test(claim.payment_intent_ref) ||
    !/^acct_[A-Za-z0-9]+$/.test(claim.destination_account_ref) ||
    !/^[0-9a-f-]{36}$/i.test(claim.operation_id) ||
    !/^[0-9a-f-]{36}$/i.test(claim.lease) ||
    claim.currency !== 'CAD' ||
    !Number.isSafeInteger(Number(claim.amount_cents)) ||
    Number(claim.amount_cents) <= 0 ||
    !['execute', 'reconcile'].includes(claim.claim_kind)
  )
    throw new ProviderValidationError('Invalid transfer claim.', 'binding')
}

function validatePaymentIntent(
  intent: Stripe.PaymentIntent,
  claim: ClaimedOrderTransfer
) {
  if (
    intent.id !== claim.payment_intent_ref ||
    intent.livemode ||
    intent.status !== 'succeeded' ||
    intent.amount_received !== intent.amount ||
    intent.currency !== 'cad' ||
    providerId(intent.on_behalf_of) !== claim.destination_account_ref ||
    intent.transfer_group !== claim.transfer_group ||
    intent.metadata.uu_kind !== 'marketplace_order' ||
    intent.metadata.uu_order !== claim.order_id ||
    intent.metadata.uu_attempt !== claim.payment_attempt_id ||
    intent.metadata.uu_environment !== 'staging'
  )
    throw new ProviderValidationError(
      'Original payment binding mismatch.',
      'binding'
    )
  const chargeId = providerId(intent.latest_charge)
  if (!chargeId?.match(/^ch_[A-Za-z0-9]+$/))
    throw new ProviderValidationError(
      'Trusted source Charge missing.',
      'binding'
    )
  return chargeId
}

function validateCharge(
  charge: Stripe.Charge,
  claim: ClaimedOrderTransfer,
  intent: Stripe.PaymentIntent
) {
  if (
    charge.livemode ||
    !charge.paid ||
    !charge.captured ||
    charge.status !== 'succeeded' ||
    charge.disputed ||
    charge.amount !== intent.amount_received ||
    charge.currency !== 'cad' ||
    providerId(charge.payment_intent) !== claim.payment_intent_ref ||
    providerId(charge.on_behalf_of) !== claim.destination_account_ref ||
    charge.transfer_group !== claim.transfer_group ||
    charge.metadata.uu_order !== claim.order_id ||
    charge.metadata.uu_attempt !== claim.payment_attempt_id
  )
    throw new ProviderValidationError('Source Charge mismatch.', 'binding')
  if (
    (claim.transfer_kind === 'sale_proceeds' && charge.amount_refunded !== 0) ||
    (claim.transfer_kind === 'delivery_compensation' &&
      charge.amount_refunded + Number(claim.amount_cents) !== charge.amount)
  )
    throw new ProviderValidationError(
      'Refund and Transfer conservation mismatch.',
      'binding'
    )
}

async function validateRecipient(stripe: Stripe, claim: ClaimedOrderTransfer) {
  const account = await stripe.accounts.retrieve(claim.destination_account_ref)
  if (
    'deleted' in account ||
    !account.details_submitted ||
    account.capabilities?.transfers !== 'active'
  )
    throw new ProviderValidationError(
      'Seller transfer destination is not ready.',
      'recipient'
    )
}

function validateTransfer(
  transfer: Stripe.Transfer,
  claim: ClaimedOrderTransfer,
  sourceCharge: string
) {
  const metadata = transfer.metadata || {}
  if (
    !/^tr_[A-Za-z0-9]+$/.test(transfer.id) ||
    (claim.transfer_ref !== null && transfer.id !== claim.transfer_ref) ||
    transfer.livemode ||
    transfer.amount !== Number(claim.amount_cents) ||
    transfer.currency !== 'cad' ||
    providerId(transfer.destination) !== claim.destination_account_ref ||
    providerId(transfer.source_transaction) !== sourceCharge ||
    transfer.transfer_group !== claim.transfer_group ||
    metadata.uu_kind !== 'marketplace_order_transfer' ||
    metadata.uu_order !== claim.order_id ||
    metadata.uu_attempt !== claim.payment_attempt_id ||
    metadata.uu_operation !== claim.operation_id ||
    metadata.uu_transfer_kind !== claim.transfer_kind ||
    metadata.uu_environment !== 'staging'
  )
    throw new ProviderValidationError('Transfer binding mismatch.', 'binding')
  return transfer
}

async function findTransfer(
  stripe: Stripe,
  claim: ClaimedOrderTransfer,
  sourceCharge: string
) {
  if (claim.transfer_ref)
    return validateTransfer(
      await stripe.transfers.retrieve(claim.transfer_ref),
      claim,
      sourceCharge
    )
  const matches: Stripe.Transfer[] = []
  let startingAfter: string | undefined
  for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
    const page = await stripe.transfers.list({
      destination: claim.destination_account_ref,
      transfer_group: claim.transfer_group,
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {}),
    })
    for (const transfer of page.data) {
      if (transfer.metadata?.uu_operation === claim.operation_id)
        matches.push(validateTransfer(transfer, claim, sourceCharge))
      else
        throw new ProviderValidationError(
          'Conflicting Transfer exists for Order.',
          'binding'
        )
    }
    if (!page.has_more) break
    startingAfter = page.data.at(-1)?.id
    if (!startingAfter)
      throw new ProviderValidationError(
        'Incomplete Transfer pagination.',
        'binding'
      )
  }
  if (matches.length > 1)
    throw new ProviderValidationError(
      'Duplicate Transfers detected.',
      'binding'
    )
  return matches[0] || null
}

function observation(
  transfer: Stripe.Transfer,
  claim: ClaimedOrderTransfer,
  sourceCharge: string,
  evidenceId = `reconcile:${randomUUID()}`
) {
  const metadata = transfer.metadata || {}
  return {
    amount: String(transfer.amount),
    amountReversed: String(transfer.amount_reversed),
    currency: transfer.currency,
    destination: providerId(transfer.destination),
    evidenceId,
    livemode: transfer.livemode,
    metadataAttempt: metadata.uu_attempt || null,
    metadataEnvironment: metadata.uu_environment || null,
    metadataKind: metadata.uu_kind || null,
    metadataOperation: metadata.uu_operation || null,
    metadataOrder: metadata.uu_order || null,
    operationId: claim.operation_id,
    paymentIntentRef: claim.payment_intent_ref,
    providerMode: claim.provider_mode,
    providerPlatform: claim.provider_platform,
    reversed: transfer.reversed,
    sourceChargeRef: sourceCharge,
    transferGroup: transfer.transfer_group,
    transferRef: transfer.id,
  }
}

function defer(
  claim: ClaimedOrderTransfer,
  errorCode:
    | 'provider_mismatch'
    | 'provider_unavailable'
    | 'recipient_not_ready'
    | 'insufficient_funds'
    | 'unknown_outcome'
) {
  return operationRpc<TransferResult>('defer', claim, { errorCode })
}

export async function processClaimedOrderTransfer(claim: ClaimedOrderTransfer) {
  assertTransferWorkEnabled()
  const { config, stripe } = await stripeRuntime()
  try {
    assertClaim(claim, config.platform)
    const intent = await stripe.paymentIntents.retrieve(
      claim.payment_intent_ref
    )
    const sourceCharge = validatePaymentIntent(intent, claim)
    const charge = await stripe.charges.retrieve(sourceCharge)
    validateCharge(charge, claim, intent)
    await validateRecipient(stripe, claim)
    let transfer = await findTransfer(stripe, claim, sourceCharge)
    if (!transfer && claim.claim_kind === 'reconcile')
      return defer(claim, 'unknown_outcome')
    if (!transfer) {
      let createStarted = false
      try {
        createStarted = true
        transfer = await stripe.transfers.create(
          {
            amount: Number(claim.amount_cents),
            currency: 'cad',
            destination: claim.destination_account_ref,
            source_transaction: sourceCharge,
            transfer_group: claim.transfer_group,
            metadata: {
              uu_kind: 'marketplace_order_transfer',
              uu_order: claim.order_id,
              uu_attempt: claim.payment_attempt_id,
              uu_operation: claim.operation_id,
              uu_transfer_kind: claim.transfer_kind,
              uu_environment: 'staging',
            },
          },
          { idempotencyKey: claim.idempotency_key }
        )
      } catch (error) {
        const providerError = error as { code?: unknown } | null
        const code =
          providerError && typeof providerError.code === 'string'
            ? providerError.code
            : null
        return defer(
          claim,
          code === 'balance_insufficient' || code === 'insufficient_funds'
            ? 'insufficient_funds'
            : createStarted
            ? 'unknown_outcome'
            : 'provider_unavailable'
        )
      }
    }
    validateTransfer(transfer, claim, sourceCharge)
    return operationRpc<TransferResult>(
      'apply',
      claim,
      observation(transfer, claim, sourceCharge)
    )
  } catch (error) {
    if (error instanceof ProviderValidationError)
      return defer(
        claim,
        error.kind === 'recipient' ? 'recipient_not_ready' : 'provider_mismatch'
      )
    return defer(claim, 'provider_unavailable')
  }
}

async function drainTransferEvents(limit: number) {
  const { config, stripe } = await stripeRuntime()
  let processed = 0
  let retried = 0
  let mismatches = 0
  for (let index = 0; index < limit; index++) {
    const event = await eventRpc<TransferEventClaim>('claim', config.platform)
    if (!event) break
    try {
      const transfer = await stripe.transfers.retrieve(event.providerReference)
      const metadata = transfer.metadata || {}
      const operation = await readTransfer(
        metadata.uu_order || '',
        config.platform
      )
      if (!operation) {
        await eventRpc('retry', config.platform, event.lease, {
          eventId: event.eventId,
          reason: 'operation_unavailable',
        })
        retried++
        continue
      }
      validateTransfer(
        transfer,
        operation,
        providerId(transfer.source_transaction) || ''
      )
      await eventRpc('done', config.platform, event.lease, {
        amount: String(transfer.amount),
        currency: transfer.currency,
        destination: providerId(transfer.destination),
        eventId: event.eventId,
        metadataOperation: metadata.uu_operation,
        metadataOrder: metadata.uu_order,
        transferRef: transfer.id,
      })
      processed++
    } catch (error) {
      if (error instanceof ProviderValidationError) {
        await eventRpc('done_mismatch', config.platform, event.lease, {
          eventId: event.eventId,
        })
        mismatches++
      } else {
        await eventRpc('retry', config.platform, event.lease, {
          eventId: event.eventId,
          reason: 'provider_unavailable',
        })
        retried++
      }
    }
  }
  return { processed, retried, mismatches }
}

async function prepareAuthorizedTransfers(limit: number) {
  const { config } = await stripeRuntime()
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_order_transfer_candidates',
    { p_platform: config.platform, p_limit: limit }
  )
  if (error) throw new ListingApiError('Transfer discovery failed.', 503)
  let prepared = 0
  let skipped = 0
  for (const candidate of (data || []) as Array<{ order_id: string }>) {
    try {
      if (await prepareTransfer(candidate.order_id, config.platform)) prepared++
      else skipped++
    } catch {
      skipped++
    }
  }
  return { prepared, skipped }
}

async function drainTransfers(limit: number) {
  const { config } = await stripeRuntime()
  let processed = 0
  let exceptions = 0
  for (let index = 0; index < limit; index++) {
    const claim = await claimDue(config.platform)
    if (!claim) break
    const result = await processClaimedOrderTransfer(claim)
    processed++
    if (result.result === 'exception') exceptions++
  }
  return { processed, exceptions }
}

export async function drainStripeOrderTransferWork(limit = 10) {
  const bounded = Math.max(1, Math.min(limit, 10))
  if (
    process.env.STRIPE_ORDER_TRANSFERS_ENABLED !== 'true' ||
    process.env.STRIPE_ORDER_TRANSFERS_CREATE_APPROVED !== 'true'
  )
    return {
      enabled: false,
      events: { processed: 0, retried: 0, mismatches: 0 },
      discovery: { prepared: 0, skipped: 0 },
      transfers: { processed: 0, exceptions: 0 },
    }
  const events = await drainTransferEvents(bounded)
  const discovery = await prepareAuthorizedTransfers(bounded)
  const transfers = await drainTransfers(bounded)
  return { enabled: true, events, discovery, transfers }
}
