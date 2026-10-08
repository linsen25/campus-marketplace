/* eslint-disable jsx-a11y/no-noninteractive-element-interactions -- Image error callbacks renew private media. */
/* eslint @next/next/no-img-element: off -- Local message object URLs. */
'use client'

import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useReducedMotion,
} from 'motion/react'
import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'

import type { ImageAttachment } from '@/types/message'

import styles from './expandable-gallery.module.css'

const spring = { type: 'spring', stiffness: 160, damping: 18, mass: 1 } as const
const positions = [
  { rotate: -15, x: -42, y: 10 },
  { rotate: -3, x: -5, y: -10 },
  { rotate: 12, x: 40, y: 5 },
]

/** Supplied stacked/shared-layout gallery, adapted to local chat photos. */
export default function ExpandableGallery({
  images,
  onImageError,
}: {
  images: readonly ImageAttachment[]
  onImageError?: () => void
}) {
  const [expanded, setExpanded] = useState(false)
  const id = useId()
  const container = useRef<HTMLDivElement>(null)
  const scrollPosition = useRef<number | null>(null)
  const reduced = useReducedMotion()
  const transition = reduced ? { duration: 0 } : spring
  const close = () => setExpanded(false)
  const restoreScroll = () => {
    if (expanded || scrollPosition.current === null) return
    const history = container.current?.closest<HTMLElement>(
      '[data-message-history]'
    )
    if (!history) return
    const top = scrollPosition.current
    history.scrollTop = top
    // Browser scroll anchoring can run after layout/exit callbacks. Restore after
    // that layout frame as well, without a time-based delay or navigation change.
    requestAnimationFrame(() => {
      if (!history.isConnected) return
      history.scrollTop = top
      requestAnimationFrame(() => {
        if (history.isConnected) history.scrollTop = top
      })
    })
  }
  useLayoutEffect(() => {
    if (!expanded && scrollPosition.current !== null) {
      const history = container.current?.closest<HTMLElement>(
        '[data-message-history]'
      )
      if (history) history.scrollTop = scrollPosition.current
    }
  }, [expanded])
  useEffect(() => {
    if (!expanded) return undefined
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [expanded])
  const open = () => {
    scrollPosition.current =
      container.current?.closest<HTMLElement>('[data-message-history]')
        ?.scrollTop ?? null
    setExpanded(true)
  }
  return (
    <div
      ref={container}
      className={styles.gallery}
      data-image-gallery="true"
      data-expanded={expanded}
    >
      <LayoutGroup id={id}>
        <AnimatePresence onExitComplete={restoreScroll}>
          {expanded && (
            <motion.button
              type="button"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className={styles.back}
              onClick={close}
            >
              ← Go back to chat
            </motion.button>
          )}
        </AnimatePresence>
        <motion.div
          layout={true}
          className={expanded ? styles.grid : styles.stack}
          transition={transition}
          onLayoutAnimationComplete={restoreScroll}
        >
          {images.map((image, index) => {
            if (index >= 3 && !expanded) return null
            const position = positions[index] ?? positions[1]
            return (
              <motion.button
                layout={true}
                key={image.id}
                type="button"
                layoutId={`card-container-${image.id}`}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  rotate: expanded ? 0 : position.rotate,
                  x: expanded ? 0 : position.x,
                  y: expanded ? 0 : position.y,
                  zIndex: expanded ? 10 : (index + 1) * 10,
                }}
                transition={transition}
                whileHover={
                  !expanded && !reduced
                    ? {
                        scale: 1.05,
                        y: position.y - 15,
                        rotate: position.rotate * 0.8,
                        zIndex: 50,
                      }
                    : undefined
                }
                className={expanded ? styles.expandedPhoto : styles.photo}
                aria-label={`View photo ${index + 1} of ${images.length}`}
                onClick={expanded ? undefined : open}
              >
                <motion.div
                  layoutId={`image-inner-${image.id}`}
                  layout="position"
                  className={styles.image}
                  transition={transition}
                >
                  <img
                    src={image.previewUrl}
                    alt={image.name}
                    draggable={false}
                    onError={onImageError}
                  />
                </motion.div>
              </motion.button>
            )
          })}
        </motion.div>
        {!expanded && (
          <button type="button" className={styles.back} onClick={open}>
            See all {images.length} photos →
          </button>
        )}
      </LayoutGroup>
    </div>
  )
}
