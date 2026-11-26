import { Star } from 'lucide-react'

export function RatingStars({
  rating,
  count,
  emptyLabel = 'New',
}: {
  rating: number | null
  count: number
  emptyLabel?: string
}) {
  if (!count || rating === null)
    return <span aria-label={emptyLabel}>{emptyLabel}</span>
  return (
    <span
      aria-label={`${rating.toFixed(1)} out of 5 from ${count} reviews`}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 2,
        color: '#f3c86b',
      }}
    >
      {Array.from({ length: 5 }, (_, index) => (
        <Star
          key={index}
          size={15}
          fill={
            rating >= index + 1
              ? 'currentColor'
              : rating >= index + 0.5
              ? 'currentColor'
              : 'none'
          }
          strokeWidth={2}
        />
      ))}
      <strong style={{ color: 'inherit', marginLeft: 5 }}>
        {rating.toFixed(1)}
      </strong>
      <span style={{ color: '#bba9ca', marginLeft: 3 }}>({count})</span>
    </span>
  )
}
