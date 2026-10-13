import grid from '@/components/listings/listing-workspace.module.css'
import { Skeleton } from '@/components/ui/skeleton'

import styles from './workspace-skeletons.module.css'

export function ListingSkeletonGrid({
  className = '',
}: {
  className?: string
}) {
  return (
    <div
      className={`${className || grid.grid}`}
      role="status"
      aria-label="Loading listings"
    >
      {[0, 1, 2, 3, 4, 5].map((id) => (
        <article key={id} className={`${styles.card} ${styles.stack}`}>
          <Skeleton className={styles.media} />
          <Skeleton className={styles.line} />
          <Skeleton className={styles.short} />
          <Skeleton className={styles.action} />
        </article>
      ))}
    </div>
  )
}
export function ChatBodySkeleton() {
  return (
    <div
      className={styles.body}
      role="status"
      aria-label="Loading message history"
    >
      {[0, 1, 2, 3, 4].map((id) => (
        <Skeleton key={id} className={styles.bubble} />
      ))}
    </div>
  )
}
export function MessagesWorkspaceSkeleton({ mobile }: { mobile: boolean }) {
  return (
    <div
      className={styles.workspace}
      role="status"
      aria-label="Loading conversations"
    >
      {!mobile && (
        <div className={`${styles.rail} ${styles.stack}`}>
          {[0, 1, 2].map((id) => (
            <Skeleton key={id} className={styles.avatar} />
          ))}
        </div>
      )}
      {mobile ? (
        <div className={`${styles.chat} ${styles.stack}`}>
          {[0, 1, 2, 3].map((id) => (
            <div key={id} className={styles.row}>
              <Skeleton className={styles.avatar} />
              <div className={styles.stack} style={{ flex: 1 }}>
                <Skeleton className={styles.line} />
                <Skeleton className={styles.short} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className={styles.chat}>
          <div className={styles.row}>
            <Skeleton className={styles.avatar} />
            <Skeleton className={styles.line} />
          </div>
          <ChatBodySkeleton />
          <Skeleton style={{ height: 40, width: '100%' }} />
        </div>
      )}
    </div>
  )
}
export function RequestTimelineSkeleton() {
  return (
    <div
      className={styles.stack}
      role="status"
      aria-label="Loading Order Requests"
      style={{ padding: 12 }}
    >
      {[0, 1].map((id) => (
        <div
          className={`${styles.card} ${styles.stack}`}
          key={id}
          style={{ maxWidth: 360 }}
        >
          <Skeleton className={styles.short} />
          <Skeleton className={styles.line} />
          <Skeleton className={styles.action} />
        </div>
      ))}
    </div>
  )
}
