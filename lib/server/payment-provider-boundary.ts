// Server-only contracts. B20 does not execute provider operations or change Orders.
export type PaymentProvider = 'stripe'
export type ProviderMode = 'live' | 'test'
export type PaymentPurpose =
  | 'account_setup'
  | 'marketplace_order'
  | 'shop_membership'

export type FrozenOrderEconomics = {
  orderId: string
  currency: 'CAD'
  itemCents: number
  deliveryCents: number
  buyerServiceFeeCents: number
  buyerTotalCents: number
  sellerGrossCents: number
  sellerPlatformFeeCents: 0
}

export type ProviderOperationIdentity = {
  provider: PaymentProvider
  mode: ProviderMode
  platformAccountId: string
  purpose: PaymentPurpose
  operationId: string
  idempotencyKey: string
}

export type ProviderAttempt = ProviderOperationIdentity & {
  attemptId: string
  providerReference: string | null
}

export type OrderPaymentOperationRequest = {
  purpose: 'marketplace_order'
  attempt: ProviderAttempt & { purpose: 'marketplace_order' }
  economics: FrozenOrderEconomics
  buyerId: string
  providerCustomerId: string
}

export type MembershipPaymentOperationRequest = {
  purpose: 'shop_membership'
  operation: ProviderOperationIdentity & { purpose: 'shop_membership' }
  membershipId: string
  ownerId: string
  amountCents: number
  currency: 'CAD'
}

export type ProviderPaymentOperationRequest =
  | MembershipPaymentOperationRequest
  | OrderPaymentOperationRequest

export type ProviderOperationOutcome =
  | 'FAILURE'
  | 'RECONCILIATION_REQUIRED'
  | 'SUCCESS'
  | 'UNKNOWN'

export type ProviderOperationResult = {
  identity: ProviderOperationIdentity
  providerReference: string | null
  outcome: ProviderOperationOutcome
}

export type ProviderEvidenceBinding = {
  provider: PaymentProvider
  mode: ProviderMode
  platformAccountId: string
  purpose: PaymentPurpose
  operationId: string
  providerReference: string
  orderId: string | null
  attemptId: string | null
  providerCustomerId: string | null
  amountCents: number | null
  currency: string | null
}

export type TrustedProviderEvidence = {
  trust: 'server_verified'
  source: 'stripe_server_retrieval'
  evidenceId: string
  observedAt: string
  binding: ProviderEvidenceBinding
  outcome: ProviderOperationOutcome
  terminal: boolean
}

export type VerifiedProviderEventNotice = {
  trust: 'server_verified'
  source: 'stripe_signed_webhook'
  evidenceId: string
  observedAt: string
  binding: ProviderEvidenceBinding
  outcome: 'RECONCILIATION_REQUIRED'
  terminal: false
}

export type UntrustedPaymentClaim = {
  trust: 'unverified'
  source: 'client' | 'offer_accept' | 'simulator'
  claimedOutcome: ProviderOperationOutcome
}

export type PaymentEvidence =
  | TrustedProviderEvidence
  | UntrustedPaymentClaim
  | VerifiedProviderEventNotice

export type OrderPaymentExpectation = {
  attempt: ProviderAttempt & { purpose: 'marketplace_order' }
  economics: FrozenOrderEconomics
  providerCustomerId: string
}

export type ExistingPaymentDecision = {
  evidenceIds: readonly string[]
  terminalOutcome: 'FAILURE' | 'SUCCESS' | null
}

export type OrderPaymentAuthority =
  | 'cancellation_pending'
  | 'cancelled'
  | 'payment_open'
  | 'terminal'

export type OrderPaymentDecision =
  | { action: 'apply_failed'; evidenceId: string }
  | { action: 'apply_paid'; evidenceId: string }
  | { action: 'conflict_review'; reason: string }
  | { action: 'duplicate'; evidenceId: string }
  | { action: 'reconcile_existing'; reason: string }
  | { action: 'reject'; reason: string }
  | { action: 'retain_for_cancellation_resolution'; evidenceId: string }

export type PaymentRetryDecision =
  | { action: 'reconcile_attempt'; attempt: ProviderAttempt }
  | { action: 'reject'; reason: string }
  | { action: 'reuse_attempt'; attempt: ProviderAttempt }

function sameIdentity(
  expected: ProviderOperationIdentity,
  actual: ProviderOperationIdentity
) {
  return (
    expected.provider === actual.provider &&
    expected.mode === actual.mode &&
    expected.platformAccountId === actual.platformAccountId &&
    expected.purpose === actual.purpose &&
    expected.operationId === actual.operationId &&
    expected.idempotencyKey === actual.idempotencyKey
  )
}

function evidenceMatchesOrder(
  expected: OrderPaymentExpectation,
  evidence: TrustedProviderEvidence | VerifiedProviderEventNotice
) {
  const binding = evidence.binding
  return (
    binding.provider === expected.attempt.provider &&
    binding.mode === expected.attempt.mode &&
    binding.platformAccountId === expected.attempt.platformAccountId &&
    binding.purpose === 'marketplace_order' &&
    binding.operationId === expected.attempt.operationId &&
    binding.providerReference === expected.attempt.providerReference &&
    binding.orderId === expected.economics.orderId &&
    binding.attemptId === expected.attempt.attemptId &&
    binding.providerCustomerId === expected.providerCustomerId &&
    binding.amountCents === expected.economics.buyerTotalCents &&
    binding.currency === expected.economics.currency
  )
}

export function decideOrderPaymentEvidence(
  expected: OrderPaymentExpectation,
  evidence: PaymentEvidence,
  authority: OrderPaymentAuthority,
  existing: ExistingPaymentDecision
): OrderPaymentDecision {
  if (evidence.trust !== 'server_verified')
    return { action: 'reject', reason: 'untrusted_payment_claim' }
  if (!evidenceMatchesOrder(expected, evidence))
    return { action: 'reject', reason: 'provider_evidence_binding_mismatch' }
  if (existing.evidenceIds.includes(evidence.evidenceId))
    return { action: 'duplicate', evidenceId: evidence.evidenceId }

  const terminalOutcome =
    evidence.terminal &&
    (evidence.outcome === 'SUCCESS' || evidence.outcome === 'FAILURE')
      ? evidence.outcome
      : null
  if (
    existing.terminalOutcome &&
    terminalOutcome &&
    existing.terminalOutcome !== terminalOutcome
  )
    return {
      action: 'conflict_review',
      reason: 'conflicting_terminal_evidence',
    }
  if (existing.terminalOutcome)
    return { action: 'duplicate', evidenceId: evidence.evidenceId }
  if (authority === 'terminal')
    return { action: 'conflict_review', reason: 'order_already_terminal' }

  if (evidence.outcome === 'SUCCESS') {
    if (!evidence.terminal)
      return { action: 'reconcile_existing', reason: 'success_not_terminal' }
    if (authority === 'payment_open')
      return { action: 'apply_paid', evidenceId: evidence.evidenceId }
    return {
      action: 'retain_for_cancellation_resolution',
      evidenceId: evidence.evidenceId,
    }
  }
  if (evidence.outcome === 'FAILURE') {
    if (!evidence.terminal)
      return { action: 'reconcile_existing', reason: 'failure_not_terminal' }
    if (authority === 'payment_open')
      return { action: 'apply_failed', evidenceId: evidence.evidenceId }
    return {
      action: 'conflict_review',
      reason: 'late_failure_after_cancellation',
    }
  }
  return {
    action: 'reconcile_existing',
    reason:
      evidence.outcome === 'UNKNOWN'
        ? 'provider_outcome_unknown'
        : 'provider_reconciliation_required',
  }
}

export function decidePaymentRetry(
  attempt: ProviderAttempt,
  result: ProviderOperationResult | null
): PaymentRetryDecision {
  if (!result) return { action: 'reuse_attempt', attempt }
  if (!sameIdentity(attempt, result.identity))
    return { action: 'reject', reason: 'provider_operation_identity_mismatch' }
  if (
    attempt.providerReference &&
    result.providerReference &&
    attempt.providerReference !== result.providerReference
  )
    return { action: 'reject', reason: 'provider_reference_mismatch' }

  const stableAttempt = {
    ...attempt,
    providerReference: attempt.providerReference || result.providerReference,
  }
  if (result.outcome === 'FAILURE')
    return { action: 'reuse_attempt', attempt: stableAttempt }
  return { action: 'reconcile_attempt', attempt: stableAttempt }
}

export function paymentModeUsesProvider(paymentMode: 'external' | 'uu_pay') {
  return paymentMode === 'uu_pay'
}

export interface PaymentProviderBoundary {
  createOrderPayment: (
    request: OrderPaymentOperationRequest
  ) => Promise<ProviderOperationResult>
  reconcileOrderPayment: (
    request: OrderPaymentOperationRequest
  ) => Promise<TrustedProviderEvidence>
  verifyProviderEvent: (
    rawBody: Uint8Array,
    headers: Readonly<Record<string, string>>
  ) => Promise<VerifiedProviderEventNotice>
}
