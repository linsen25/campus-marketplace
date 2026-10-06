import type { ReactNode } from 'react'

import styles from './action-row.module.css'

/** Adapt the existing card footer contract to two or three equal actions. */
export function ActionRow({
  children,
  three = false,
  mobileThree = false,
}: {
  children: ReactNode
  three?: boolean
  mobileThree?: boolean
}) {
  return (
    <div
      className={`${styles.row} ${three ? styles.three : ''} ${
        mobileThree ? styles.mobileThree : ''
      }`}
      data-action-row={three || mobileThree ? 'three' : 'two'}
    >
      {children}
    </div>
  )
}
