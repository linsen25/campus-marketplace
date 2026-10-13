import { Skeleton } from '@/components/ui/skeleton'

import styles from './order-detail-preview.module.css'
import profile from './profile.module.css'
/** Ready for real backend loading. Local in-memory previews never pretend to load. */
export function OrderListSkeleton() {
  return (
    <div className={styles.orderList} role="status" aria-label="Loading orders">
      {[0, 1, 2, 3].map((id) => (
        <article key={id} className={`${profile.panel} ${styles.orderCard}`}>
          <div style={{ display: 'grid', gap: 16, flex: 1 }}>
            <Skeleton style={{ height: 24, width: '70%' }} />
            <Skeleton style={{ height: 18, width: '40%' }} />
            <Skeleton style={{ height: 28, width: '60%' }} />
            <Skeleton style={{ height: 16, width: '80%' }} />
          </div>
          <Skeleton style={{ height: 40, width: 120, maxWidth: '100%' }} />
        </article>
      ))}
    </div>
  )
}
export function OrderDetailSkeleton() {
  return (
    <section
      className={styles.detail}
      role="status"
      aria-label="Loading order details"
    >
      <div className={styles.header}>
        <Skeleton style={{ height: 64, width: '60%' }} />
        <Skeleton style={{ height: 40, width: 120 }} />
      </div>
      <div className={profile.panel} style={{ display: 'grid', gap: 16 }}>
        <Skeleton style={{ height: 28, width: '50%' }} />
        <Skeleton style={{ height: 18, width: '60%' }} />
      </div>
      <div className={`${profile.panel} ${styles.progress}`}>
        <Skeleton style={{ height: 24, width: 160, marginBottom: 24 }} />
        <Skeleton style={{ height: 64, width: '100%' }} />
      </div>
      <Skeleton style={{ height: 40, width: 300, maxWidth: '100%' }} />
      <div className={`${profile.panel} ${styles.overview}`}>
        <div>
          <Skeleton style={{ aspectRatio: '4 / 3', width: '100%' }} />
          <Skeleton style={{ height: 48, marginTop: 20 }} />
        </div>
        <div style={{ display: 'grid', gap: 18 }}>
          <Skeleton style={{ height: 24, width: '60%' }} />
          {[0, 1, 2, 3, 4].map((id) => (
            <Skeleton key={id} style={{ height: 28, width: '90%' }} />
          ))}
        </div>
      </div>
    </section>
  )
}
export function OrderLoadError({
  message,
  onRetry,
}: {
  message: string
  onRetry: () => void
}) {
  return (
    <div className={styles.loadingCard} role="alert">
      <p>{message}</p>
      <button type="button" className={styles.secondary} onClick={onRetry}>
        Retry
      </button>
    </div>
  )
}
