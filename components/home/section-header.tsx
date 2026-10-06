import type { ReactNode } from 'react'

import styles from './section-header.module.css'

export function SectionHeader({
  title,
  children,
}: {
  title: string
  children?: ReactNode
}) {
  return (
    <header className={styles.header} data-home-section-header={true}>
      <h2>{title}</h2>
      {children}
    </header>
  )
}
