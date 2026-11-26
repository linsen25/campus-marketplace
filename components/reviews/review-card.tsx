import { useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { submitReviewReply } from '@/lib/reviews-api'
import type { SavedReview } from '@/types/review'

import { RatingStars } from './rating-stars'

export function ReviewCard({ review }: { review: SavedReview }) {
  const [reply, setReply] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [savedReply, setSavedReply] = useState(review.reply)
  const save = async () => {
    if (!reply.trim() || busy) return
    setBusy(true)
    setError('')
    try {
      setSavedReply(await submitReviewReply(review.reviewId, reply.trim()))
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Unable to submit reply.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <article
      aria-label="Review"
      style={{
        display: 'grid',
        gap: 10,
        padding: 14,
        border: '1px solid rgb(216 189 240 / 18%)',
        borderRadius: 14,
      }}
    >
      <div>
        <strong>{review.reviewerName || 'Buyer'}</strong>{' '}
        <RatingStars rating={review.ratingUnits / 2} count={1} emptyLabel="" />
      </div>
      {review.quickTags.length > 0 && <p>{review.quickTags.join(' · ')}</p>}
      {review.comment && <p>{review.comment}</p>}
      <time dateTime={review.reviewedAt}>
        {new Date(review.reviewedAt).toLocaleDateString('en-CA')}
      </time>
      {savedReply && (
        <p>
          <strong>Seller reply</strong>
          <br />
          {savedReply.reply}
        </p>
      )}
      {review.canReply && !savedReply && (
        <div>
          <textarea
            value={reply}
            maxLength={500}
            onChange={(event) => setReply(event.target.value)}
            aria-label="Seller reply"
          />
          <ShiningButton
            variant="purple"
            size="compact"
            showArrow={false}
            loading={busy}
            disabled={busy || !reply.trim()}
            onClick={() => void save()}
          >
            Reply
          </ShiningButton>
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </article>
  )
}
