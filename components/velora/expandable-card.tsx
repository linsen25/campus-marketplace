'use client'

import cn from 'classnames'
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react'
import type { ReactNode } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

import styles from './expandable-card.module.css'

interface ExpandableCardProps {
  title: string
  expandedTitle: string
  children: ReactNode
  media?: ReactNode
  topAction?: ReactNode
  primaryAction?: ReactNode
  className?: string
}

function ExpandableCardScrollArea({
  children,
  settled,
}: {
  children: ReactNode
  settled: boolean
}) {
  const isPresent = useIsPresent()
  return (
    <div
      className={cn(
        styles.scrollArea,
        (!settled || !isPresent) && styles.scrollAreaTransitioning
      )}
    >
      {children}
    </div>
  )
}

// Adapted from the supplied Velora source: preserve its shared layout IDs,
// media 320/32 spring, presence/backdrop transitions and keyboard focus cycle.
// Prices and the stable trigger are content, never shared layout geometry.
export function ExpandableCard({
  title,
  expandedTitle,
  children,
  media,
  topAction,
  primaryAction,
  className,
}: ExpandableCardProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [settled, setSettled] = useState(false)
  const id = useId()
  const reducedMotion = useReducedMotion()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => setMounted(true), [])

  // Keep the lock and focus trap through the closing animation, not just open.
  useEffect(() => {
    if (!active) return undefined
    const trigger = triggerRef.current
    const dialog = dialogRef.current
    const x = window.scrollX
    const y = window.scrollY
    const body = document.body
    const html = document.documentElement
    const previous = {
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    }
    const oldOverflow = html.style.overflow
    const oldScrollBehavior = html.style.scrollBehavior
    const page = document.getElementById('__next')
    const wasInert = page?.hasAttribute('inert')
    const gutter = window.innerWidth - html.clientWidth
    body.style.paddingRight = `${
      parseFloat(getComputedStyle(body).paddingRight) + gutter
    }px`
    body.style.overflow = 'hidden'
    html.style.overflow = 'hidden'
    page?.setAttribute('inert', '')
    dialog?.focus({ preventScroll: true })
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab' || !dialog) return
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      const focused = document.activeElement
      if (!first || !dialog.contains(focused)) {
        event.preventDefault()
        ;(first ?? dialog).focus()
      } else if (event.shiftKey && (focused === first || focused === dialog)) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && focused === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      Object.assign(body.style, previous)
      html.style.overflow = oldOverflow
      if (!wasInert) page?.removeAttribute('inert')
      html.style.scrollBehavior = 'auto'
      window.scrollTo(x, y)
      trigger?.focus({ preventScroll: true })
      html.style.scrollBehavior = oldScrollBehavior
    }
  }, [active])

  const spring = reducedMotion
    ? { duration: 0 }
    : { type: 'spring' as const, stiffness: 320, damping: 32 }
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? `dialog-${id}` : undefined}
        aria-label={`Open example listing: ${expandedTitle}, ${title}`}
        data-slot="expandable-card"
        className={cn(styles.trigger, className)}
        onClick={() => {
          setSettled(
            Boolean(
              reducedMotion ||
                !media ||
                window.matchMedia('(prefers-reduced-motion: reduce)').matches
            )
          )
          setActive(true)
          setOpen(true)
        }}
      >
        {media && (
          <motion.span
            layoutId={`media-${id}`}
            transition={spring}
            className={styles.media}
          >
            {media}
          </motion.span>
        )}
        <span className={styles.price} data-slot="collapsed-price">
          {title}
        </span>
      </button>
      {mounted &&
        createPortal(
          <AnimatePresence onExitComplete={() => setActive(false)}>
            {open && (
              <div className={styles.overlay} data-slot="listing-overlay">
                <motion.div
                  className={styles.backdrop}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{
                    duration: reducedMotion ? 0 : 0.4,
                    ease: 'easeInOut',
                  }}
                  onClick={() => setOpen(false)}
                />
                <motion.div
                  layoutRoot={true}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  ref={dialogRef}
                  id={`dialog-${id}`}
                  transition={{
                    opacity: {
                      duration: reducedMotion ? 0 : 0.4,
                      ease: 'easeInOut',
                    },
                  }}
                  role="dialog"
                  aria-modal="true"
                  aria-labelledby={`title-${id}`}
                  tabIndex={-1}
                  className={styles.dialog}
                >
                  <ExpandableCardScrollArea settled={settled}>
                    {media && (
                      <motion.div
                        layoutId={`media-${id}`}
                        transition={spring}
                        className={styles.media}
                        onLayoutAnimationComplete={() => setSettled(true)}
                      >
                        {media}
                      </motion.div>
                    )}
                    {topAction && (
                      <div className={styles.topAction}>{topAction}</div>
                    )}
                    <motion.div
                      className={styles.info}
                      initial={{
                        opacity: reducedMotion ? 1 : 0,
                      }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: reducedMotion ? 0 : 0.18 }}
                    >
                      <p className={styles.price} data-slot="expanded-price">
                        {title}
                      </p>
                      <h3 id={`title-${id}`} className={styles.title}>
                        {expandedTitle}
                      </h3>
                      {children}
                    </motion.div>
                  </ExpandableCardScrollArea>
                  <div className={styles.actions}>
                    <button
                      type="button"
                      className={styles.raisedButtonDanger}
                      onClick={() => setOpen(false)}
                    >
                      <span className={styles.raisedButtonDangerSurface}>
                        Close
                      </span>
                    </button>
                    {primaryAction}
                  </div>
                </motion.div>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </>
  )
}
