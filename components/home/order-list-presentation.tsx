import { ChevronRight } from 'lucide-react'
import { LayoutGroup, motion, useReducedMotion } from 'motion/react'
import { useId } from 'react'
import type { ReactNode } from 'react'

import { ListingMedia } from '@/components/listings/listing-media'
import type { OrderListBucket } from '@/lib/order-list-presentation'

import styles from './order-list-presentation.module.css'

export function OrderStatusTabs({
  bucket,
  activeCount,
  onChange,
}: {
  bucket: OrderListBucket
  activeCount: number
  onChange: (bucket: OrderListBucket) => void
}) {
  const id = useId()
  const reduced = useReducedMotion()
  return (
    <LayoutGroup id={id}>
      <div className={styles.tabs} role="group" aria-label="Order list view">
        {(['active', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={bucket === value}
            onClick={() => onChange(value)}
          >
            {bucket === value && (
              <motion.span
                className={styles.indicator}
                layoutId="order-list-tab"
                initial={false}
                transition={{
                  type: 'tween',
                  duration: reduced ? 0 : 0.2,
                  ease: 'easeOut',
                }}
              />
            )}
            <span className={styles.tabLabel}>
              {value === 'active' ? 'Active' : 'History'}
              {value === 'active' && (
                <span className={styles.count}>{activeCount}</span>
              )}
            </span>
          </button>
        ))}
      </div>
    </LayoutGroup>
  )
}

export function OrderListBadge({
  label,
  outcome,
}: {
  label: string
  outcome?: string | null
}) {
  return (
    <span className={styles.badge} data-outcome={outcome || undefined}>
      {label}
    </span>
  )
}

/** Shared list visuals only; callers retain perspective, status and navigation authority. */
export function OrderListCard({
  id,
  title,
  images,
  amount,
  fulfillment,
  outcome,
  provenance,
  state,
  onOpen,
}: {
  id: string
  title: string
  images: readonly string[]
  amount: string
  fulfillment?: string
  outcome?: string | null
  provenance?: ReactNode
  state: ReactNode
  onOpen: () => void
}) {
  const action = outcome ? 'View details' : 'View Order'
  return (
    <article
      className={styles.card}
      data-order-list-card={id}
      data-order-terminal={outcome || undefined}
    >
      <div className={styles.media}>
        {images.length ? (
          <ListingMedia images={images.slice(0, 1)} alt={title} />
        ) : (
          <span>No photo available</span>
        )}
      </div>
      <div className={styles.info}>
        <h4>{title}</h4>
        {provenance}
        <p className={styles.amount}>
          {amount}
          {fulfillment && <> &middot; {fulfillment}</>}
        </p>
        <div className={styles.state}>{state}</div>
      </div>
      <button
        className={styles.mobileOpen}
        type="button"
        aria-label={`${action}: ${title}`}
        onClick={onOpen}
      >
        <ChevronRight size={19} aria-hidden={true} />
      </button>
      <button
        className={styles.desktopOpen}
        data-terminal={Boolean(outcome) || undefined}
        type="button"
        onClick={onOpen}
      >
        {action}
        <ChevronRight size={16} aria-hidden={true} />
      </button>
    </article>
  )
}
