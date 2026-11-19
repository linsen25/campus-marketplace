import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { shopBillingReversalGovernanceConfiguration } from '@/lib/server/shop-billing-environment'

type ProposalKind =
  | 'no_effect'
  | 'escalate'
  | 'propose_term_revocation'
  | 'propose_term_restoration'

type ApprovalDecision = 'approved' | 'rejected'

export type TrustedBillingReviewOperator = {
  /** Internal registry id, never a role label or service-role surrogate. */
  operatorId: string
}

const unavailable = () =>
  new ListingApiError('Shop Billing reversal governance is unavailable.', 503)

/**
 * There is intentionally no staff SSO/RBAC bridge in UU-V1 yet.  Keeping this
 * resolver closed prevents service_role, request headers, or browser input
 * from being mistaken for a human reviewer identity.
 */
export async function resolveTrustedBillingReviewOperator(): Promise<TrustedBillingReviewOperator> {
  throw unavailable()
}

export async function createShopBillingReversalGovernanceProposal(input: {
  reviewId: string
  requestId: string
  proposalKind: ProposalKind
  reasonCode: string
  note?: string
  providerTermId?: string
  expiresAt: string
  expectedReviewRevision: number
}) {
  shopBillingReversalGovernanceConfiguration()
  const operator = await resolveTrustedBillingReviewOperator()
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_create_reversal_review_proposal',
    {
      p_value: {
        reviewId: input.reviewId,
        operatorId: operator.operatorId,
        requestId: input.requestId,
        proposalKind: input.proposalKind,
        reasonCode: input.reasonCode,
        note: input.note || '',
        providerTermId: input.providerTermId,
        expiresAt: input.expiresAt,
        expectedReviewRevision: input.expectedReviewRevision,
      },
    }
  )
  if (error) throw unavailable()
  return data
}

export async function approveShopBillingReversalGovernanceProposal(input: {
  proposalId: string
  requestId: string
  decision: ApprovalDecision
  reasonCode: string
  note?: string
  expectedProposalRevision: number
}) {
  shopBillingReversalGovernanceConfiguration()
  const operator = await resolveTrustedBillingReviewOperator()
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_billing_approve_reversal_review_proposal',
    {
      p_value: {
        proposalId: input.proposalId,
        operatorId: operator.operatorId,
        requestId: input.requestId,
        decision: input.decision,
        reasonCode: input.reasonCode,
        note: input.note || '',
        expectedProposalRevision: input.expectedProposalRevision,
      },
    }
  )
  if (error) throw unavailable()
  return data
}
