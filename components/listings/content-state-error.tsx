import styles from './content-state-error.module.css'
import { ContentStateRegion } from './workspace-empty'

export function ContentStateError({
  children,
  onRetry,
  className = '',
}: {
  children: string
  onRetry: () => void
  className?: string
}) {
  return (
    <ContentStateRegion className={className}>
      <div className={styles.error} role="alert">
        <p>{children}</p>
        <button type="button" onClick={onRetry}>
          Retry
        </button>
      </div>
    </ContentStateRegion>
  )
}
