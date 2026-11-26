export type ReviewSubjectType = 'resale_seller' | 'shop' | 'shop_product'

export type ReviewEligibility = {
  eligible: boolean
  reason: string | null
  expiresAt: string | null
  alreadyReviewed: boolean
}

export type SubmittedReview = {
  reviewId: string
  orderId: string
  subjectType: ReviewSubjectType
  reviewedAt: string
  idempotent: boolean
}

export type ReviewDraft = {
  ratingUnits: number | null
  quickTags: string[]
  comment: string
}

export type ReviewReply = { reply: string; repliedAt: string }

export type SavedReview = {
  reviewId: string
  orderId?: string
  subjectType: ReviewSubjectType
  ratingUnits: number
  comment: string | null
  quickTags: string[]
  reviewedAt: string
  completedAt?: string
  reviewerName?: string
  reply: ReviewReply | null
  canReply?: boolean
}

export type ReviewSummary = {
  subjectType: ReviewSubjectType
  subjectId: string
  reviewCount: number
  averageRating: number | null
}

export type PublicReviewsPage = {
  reviews: SavedReview[]
  summary: ReviewSummary
  nextCursor: { reviewedAt: string; reviewId: string } | null
}
