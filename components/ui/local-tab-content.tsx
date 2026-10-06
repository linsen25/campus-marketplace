import { AnimatePresence, m } from 'framer-motion'
import type { ReactNode } from 'react'
import { useSyncExternalStore } from 'react'

import styles from './local-tab-content.module.css'

const motionQuery = '(prefers-reduced-motion: reduce)'
const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia(motionQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const readMotion = () => window.matchMedia(motionQuery).matches

/** Only a changed local tab fades; mounting a page or updating its data does not. */
export function LocalTabContent({
  tab,
  children,
}: {
  tab: number | string
  children: ReactNode
}) {
  const reducedMotion = useSyncExternalStore(
    subscribeMotion,
    readMotion,
    () => true
  )
  return (
    <AnimatePresence initial={false} exitBeforeEnter={true}>
      <m.div
        key={tab}
        className={styles.panel}
        data-local-tab-content={tab}
        initial={{ opacity: reducedMotion ? 1 : 0 }}
        animate={{ opacity: 1 }}
        exit={{
          opacity: 0,
          transition: { duration: reducedMotion ? 0 : 0.14 },
        }}
        transition={{ duration: reducedMotion ? 0 : 0.18, ease: 'easeOut' }}
      >
        {children}
      </m.div>
    </AnimatePresence>
  )
}
