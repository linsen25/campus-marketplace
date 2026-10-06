import { motion } from 'motion/react'
import { useSyncExternalStore } from 'react'

import styles from './content-loading-spinner.module.css'

const motionQuery = '(prefers-reduced-motion: reduce)'
const subscribeMotion = (notify: () => void) => {
  const query = window.matchMedia(motionQuery)
  query.addEventListener('change', notify)
  return () => query.removeEventListener('change', notify)
}
const readMotion = () => window.matchMedia(motionQuery).matches

/** Presentation only; the surrounding content workspace owns its position. */
export function ContentLoadingSpinner() {
  const reduced = useSyncExternalStore(subscribeMotion, readMotion, () => true)
  return (
    <span
      role="status"
      aria-label="Loading content"
      data-content-loading-spinner="true"
      className={styles.indicator}
    >
      <motion.span
        aria-hidden={true}
        className={styles.ring}
        animate={{ rotate: reduced ? 0 : 360 }}
        transition={{
          duration: reduced ? 0 : 1.5,
          repeat: reduced ? 0 : Infinity,
          ease: 'linear',
        }}
      />
    </span>
  )
}
