import type { ReactNode } from 'react'

import styles from './action-row.module.css'

/** Shared action-group layout. Visual button geometry belongs to each action. */
export function ActionRow({
  children,
  three = false,
  mobileThree = false,
  align = 'between',
  compactBetween = false,
}: {
  children: ReactNode
  three?: boolean
  mobileThree?: boolean
  align?: 'between' | 'end'
  compactBetween?: boolean
}) {
  return (
    <div
      className={`${styles.row} ${align === 'end' ? styles.end : ''} ${
        three ? styles.three : ''
      } ${mobileThree ? styles.mobileThree : ''} ${
        compactBetween ? styles.compactBetween : ''
      }`}
      data-action-row={three || mobileThree ? 'three' : 'two'}
    >
      {children}
    </div>
  )
}
