import type { ReactNode } from 'react'

import styles from './section-header.module.css'

export function SectionHeader({
  title,
  children,
  subtitle,
  className,
}: {
  title: ReactNode
  subtitle?: string
  className?: string
  children?: ReactNode
}) {
  return (
    <header
      className={[styles.header, className].filter(Boolean).join(' ')}
      data-home-section-header={true}
    >
      {subtitle ? (
        <div>
          <h2>{title}</h2>
          <p>{subtitle}</p>
        </div>
      ) : (
        <h2>{title}</h2>
      )}
      {children}
    </header>
  )
}
