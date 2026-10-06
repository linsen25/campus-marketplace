import { motion } from 'motion/react'
import type { ReactNode } from 'react'

import styles from './market-layout.module.css'

export function MarketControlGroup({ children }: { children: ReactNode }) {
  return (
    <div className={styles.controls} data-market-controls="true">
      {children}
    </div>
  )
}

// The accepted Market focus surface, shared verbatim with Home listing controls.
export function MarketFocusBackdrop({
  closing,
  label = 'Close filter or sort',
  onClose,
  onClosed,
}: {
  closing: boolean
  label?: string
  onClose: () => void
  onClosed?: () => void
}) {
  return (
    <motion.button
      type="button"
      className={styles.focusBackdrop}
      data-market-focus-backdrop="true"
      aria-label={label}
      initial={{
        opacity: 0,
        backdropFilter: 'blur(0px)',
        backgroundColor: 'rgba(15,10,22,0)',
      }}
      animate={{
        opacity: closing ? 0 : 1,
        backdropFilter: closing ? 'blur(0px)' : 'blur(4px)',
        backgroundColor: closing ? 'rgba(15,10,22,0)' : 'rgba(15,10,22,0.18)',
      }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      onAnimationComplete={() => {
        if (closing) onClosed?.()
      }}
      onClick={onClose}
    />
  )
}
