// Server-only B25-B boundary. No browser route or human review authority exists.
import { ListingApiError } from '@/lib/listing-validation'
import { messageUuid } from '@/lib/server/messages-environment'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'

export const operationalCaseSourceKinds = [
  'uu_protection',
  'stripe_dispute',
  'payment_exception',
  'refund_exception',
  'transfer_exception',
  'payout_exception',
  'provider_event_exception',
] as const
export type OperationalCaseSourceKind =
  typeof operationalCaseSourceKinds[number]
export type OperationalReviewStatus =
  | 'open'
  | 'under_review'
  | 'awaiting_evidence'
  | 'blocked_policy'
  | 'resolved'

export type OperationalCaseSummary = {
  id: string
  sourceKind: OperationalCaseSourceKind
  category: string
  riskLevel: 'medium' | 'high' | 'critical'
  priority: number
  reviewStatus: OperationalReviewStatus
  responseDueAt: string | null
  holdProjection: 'active' | 'inactive' | 'unknown' | 'not_applicable'
  releaseProjection:
    | 'blocked'
    | 'existing_rules_only'
    | 'unknown'
    | 'not_applicable'
  sourceStatus: string
  sourceObservedAt: string
  version: number
  evidence: Array<{
    kind: string
    referenceId: string
    observedAt: string
  }>
}

function project(value: Record<string, unknown>): OperationalCaseSummary {
  const sourceKind = value.source_kind as OperationalCaseSourceKind
  const riskLevel = value.risk_level as OperationalCaseSummary['riskLevel']
  const reviewStatus = value.review_status as OperationalReviewStatus
  const holdProjection =
    value.hold_projection as OperationalCaseSummary['holdProjection']
  const releaseProjection =
    value.release_projection as OperationalCaseSummary['releaseProjection']
  const evidence = value.evidence
  if (
    !operationalCaseSourceKinds.includes(sourceKind) ||
    !['medium', 'high', 'critical'].includes(riskLevel) ||
    ![
      'open',
      'under_review',
      'awaiting_evidence',
      'blocked_policy',
      'resolved',
    ].includes(reviewStatus) ||
    !['active', 'inactive', 'unknown', 'not_applicable'].includes(
      holdProjection
    ) ||
    !['blocked', 'existing_rules_only', 'unknown', 'not_applicable'].includes(
      releaseProjection
    ) ||
    !Array.isArray(evidence)
  )
    throw new ListingApiError('Operational case data is invalid.', 503)
  return {
    id: messageUuid(String(value.id)),
    sourceKind,
    category: String(value.category),
    riskLevel,
    priority: Number(value.priority),
    reviewStatus,
    responseDueAt:
      typeof value.response_due_at === 'string' ? value.response_due_at : null,
    holdProjection,
    releaseProjection,
    sourceStatus: String(value.source_status),
    sourceObservedAt: String(value.source_observed_at),
    version: Number(value.version),
    evidence: evidence.map((item) => {
      const row = item as Record<string, unknown>
      return {
        kind: String(row.kind),
        referenceId: messageUuid(String(row.referenceId)),
        observedAt: String(row.observedAt),
      }
    }),
  }
}

async function rpc(value: Record<string, unknown>) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_operational_cases',
    value
  )
  if (error)
    throw new ListingApiError('Operational case service unavailable.', 503)
  return data as Record<string, unknown> | null
}

export async function readOperationalCase(caseId: string) {
  const data = await rpc({
    p_action: 'read',
    p_case: messageUuid(caseId),
    p_source_kind: null,
    p_source_id: null,
    p_expected_version: null,
    p_target_status: null,
    p_actor: null,
  })
  return data ? project(data) : null
}

export async function syncOperationalCase(
  sourceKind: OperationalCaseSourceKind,
  sourceId: string
) {
  if (
    !operationalCaseSourceKinds.includes(sourceKind) ||
    sourceKind === 'provider_event_exception'
  )
    throw new ListingApiError('Invalid operational case source.', 400)
  const data = await rpc({
    p_action: 'sync',
    p_case: null,
    p_source_kind: sourceKind,
    p_source_id: messageUuid(sourceId),
    p_expected_version: null,
    p_target_status: null,
    p_actor: null,
  })
  return data ? project(data) : null
}

export async function reviewOperationalCase(): Promise<never> {
  throw new ListingApiError(
    'Operational reviewer authority is not configured.',
    503
  )
}
