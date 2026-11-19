import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import type { ReactNode } from 'react'

import styles from './segmented-content.module.css'

/** Only the content beneath a segmented control moves between its values. */
export function SegmentedContent({
  value,
  index,
  children,
}: {
  value: string
  index: number
  children: ReactNode
}) {
  const reducedMotion = useReducedMotion()
  return (
    <div className={styles.viewport}>
      <AnimatePresence initial={false} exitBeforeEnter={true} custom={index}>
        <m.div
          key={value}
          className={styles.page}
          custom={index}
          variants={{
            enter: (next: number) => ({ x: next > 0 ? 40 : -40, opacity: 0 }),
            center: { x: 0, opacity: 1 },
            exit: (next: number) => ({ x: next > 0 ? -40 : 40, opacity: 0 }),
          }}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: reducedMotion ? 0 : 0.22, ease: 'easeInOut' }}
        >
          {children}
        </m.div>
      </AnimatePresence>
    </div>
  )
}
