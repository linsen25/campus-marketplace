import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import { MarketFocusBackdrop } from '@/components/listings/market-control-group'
import { sortPanelFade } from '@/lib/sort-panel-fade'
import type { ChatListing } from '@/types/conversation'

import { MessagesListingPreview } from './messages-listing-preview'
import styles from './messages-listing-preview.module.css'

/** Same focus surface and fade as Sort, with modal focus kept in the preview. */
export function MessagesListingOverlay({
  listing,
  destination,
  onClose,
}: {
  listing: ChatListing
  destination: string
  onClose: () => void
}) {
  const [closing, setClosing] = useState(false)
  const reduced = useReducedMotion()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const opener = document.activeElement
    ref.current
      ?.querySelector<HTMLButtonElement>('button')
      ?.focus({ preventScroll: true })
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setClosing(true)
      }
      if (event.key !== 'Tab') return
      const buttons = Array.from(
        ref.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, [tabindex="0"]'
        ) || []
      )
      const first = buttons[0]
      const last = buttons[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last?.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first?.focus()
      }
    }
    document.addEventListener('keydown', keydown)
    return () => {
      document.removeEventListener('keydown', keydown)
      if (opener instanceof HTMLElement && opener.isConnected)
        opener.focus({ preventScroll: true })
    }
  }, [])
  return createPortal(
    <>
      <MarketFocusBackdrop
        closing={closing}
        label="Close listing preview"
        onClose={() => setClosing(true)}
        onClosed={onClose}
      />
      <div className={styles.overlay}>
        <motion.div
          ref={ref}
          className={styles.dialog}
          role="dialog"
          aria-modal="true"
          aria-label="Listing preview"
          initial={{ opacity: reduced ? 1 : 0 }}
          animate={{ opacity: closing ? 0 : 1 }}
          transition={{
            ...sortPanelFade,
            duration: reduced ? 0 : sortPanelFade.duration,
          }}
          style={{ pointerEvents: closing ? 'none' : 'auto' }}
        >
          <MessagesListingPreview
            listing={listing}
            destination={destination}
            onCancel={() => setClosing(true)}
          />
        </motion.div>
      </div>
    </>,
    document.body
  )
}
