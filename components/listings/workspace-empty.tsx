import type { ReactNode } from 'react'

import styles from './listing-workspace.module.css'

/** Loading and empty content share the accepted workspace placeholder anchor. */
export function ContentStateRegion({
  children,
  empty = false,
  className = '',
}: {
  children: ReactNode
  empty?: boolean
  className?: string
}) {
  return (
    <div
      className={`${styles.emptyState} ${className}`}
      data-content-state-region="true"
      data-workspace-empty={empty || undefined}
    >
      <div
        className={styles.contentStateAnchor}
        data-content-state-anchor="true"
      >
        {children}
      </div>
    </div>
  )
}

export function WorkspaceEmpty({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <ContentStateRegion empty={true} className={className}>
      <p>{children}</p>
    </ContentStateRegion>
  )
}
