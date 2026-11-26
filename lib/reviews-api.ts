import { marketplaceRequest } from '@/lib/listings-api'
import type {
  ReviewEligibility,
  ReviewReply,
  PublicReviewsPage,
  ReviewSummary,
  ReviewSubjectType,
  SavedReview,
  SubmittedReview,
} from '@/types/review'

const base = (orderId: string) =>
  `/api/orders/${encodeURIComponent(orderId)}/review`

export function getReviewEligibility(
  orderId: string,
  subjectType: ReviewSubjectType
) {
  return marketplaceRequest<ReviewEligibility>(
    `${base(orderId)}?subjectType=${encodeURIComponent(subjectType)}`,
    'GET'
  )
}

export function submitOrderReview(input: {
  orderId: string
  subjectType: ReviewSubjectType
  ratingUnits: number
  comment: string
  quickTags: string[]
  actionId: string
}) {
  return marketplaceRequest<SubmittedReview>(base(input.orderId), 'POST', {
    subjectType: input.subjectType,
    ratingUnits: input.ratingUnits,
    comment: input.comment,
    quickTags: input.quickTags,
    actionId: input.actionId,
  })
}

export function getOrderReviews(orderId: string) {
  return marketplaceRequest<SavedReview[]>(
    `/api/orders/${encodeURIComponent(orderId)}/review-saved`,
    'GET'
  )
}

export function submitReviewReply(reviewId: string, reply: string) {
  return marketplaceRequest<ReviewReply>(
    `/api/reviews/${reviewId}/reply`,
    'POST',
    {
      reply,
    }
  )
}

export function getPublicReviewSummary(
  subjectType: ReviewSubjectType,
  subjectId: string
) {
  return marketplaceRequest<ReviewSummary>(
    `/api/reviews/summary?subjectType=${encodeURIComponent(
      subjectType
    )}&subjectId=${encodeURIComponent(subjectId)}`,
    'GET'
  )
}

export function getPublicReviews(input: {
  subjectType: ReviewSubjectType
  subjectId: string
  limit?: number
  before?: { reviewedAt: string; reviewId: string }
}) {
  const params = new URLSearchParams({
    subjectType: input.subjectType,
    subjectId: input.subjectId,
  })
  if (input.limit) params.set('limit', String(input.limit))
  if (input.before) {
    params.set('before', input.before.reviewedAt)
    params.set('beforeId', input.before.reviewId)
  }
  return marketplaceRequest<PublicReviewsPage>(
    `/api/reviews?${params.toString()}`,
    'GET'
  )
}
