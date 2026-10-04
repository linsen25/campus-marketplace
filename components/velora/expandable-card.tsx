'use client'

import cn from 'classnames'
import {
  AnimatePresence,
  motion,
  useIsPresent,
  useReducedMotion,
} from 'motion/react'
import type { CSSProperties, ReactNode } from 'react'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
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
  overlayClassName?: string
  overlayStyle?: CSSProperties
  onOverlayActiveChange?: (active: boolean) => void
  openOnMount?: boolean
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

function SourcePrice({
  visible,
  reducedMotion,
  className,
  children,
}: {
  visible: boolean
  reducedMotion: boolean | null
  className: string
  children: ReactNode
}) {
  let duration = visible ? 0.16 : 0.12
  if (reducedMotion) duration = 0
  return (
    <motion.span
      className={className}
      data-slot="collapsed-price"
      initial={false}
      animate={{ opacity: visible ? 1 : 0 }}
      transition={{ duration, ease: 'easeOut' }}
      // Only the price overrides the hidden trigger during its opening fade.
      // The shared source image keeps its existing visibility handoff.
      style={{ visibility: 'visible' }}
    >
      {children}
    </motion.span>
  )
}

function ExpandedContentFade({
  closing,
  reducedMotion,
  entrance = false,
  className,
  children,
}: {
  closing: boolean
  reducedMotion: boolean | null
  entrance?: boolean
  className: string
  children: ReactNode
}) {
  let duration = entrance && !closing ? 0.18 : 0.14
  let delay = entrance && !closing ? 0.12 : 0
  if (reducedMotion) {
    duration = 0
    delay = 0
  }
  return (
    <motion.div
      className={className}
      initial={entrance ? { opacity: reducedMotion ? 1 : 0 } : false}
      animate={{ opacity: closing ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration, delay }}
    >
      {children}
    </motion.div>
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
  overlayClassName,
  overlayStyle,
  onOverlayActiveChange,
  openOnMount = false,
}: ExpandableCardProps) {
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [settled, setSettled] = useState(false)
  const id = useId()
  const reducedMotion = useReducedMotion()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const requested = useRef(false)
  const [phase, setPhase] = useState<'idle' | 'open' | 'opening' | 'returning'>(
    'idle'
  )
  const [sourceVisible, setSourceVisible] = useState(true)
  const [returnRect, setReturnRect] = useState<DOMRect | null>(null)
  const sourceMediaRef = useRef<HTMLSpanElement>(null)
  const expandedMediaRef = useRef<HTMLDivElement>(null)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const returnArmed = useRef(false)
  const handoffFrame = useRef<number>()
  const returnFrame = useRef<number>()
  const finishReturn = useCallback(() => {
    if (phaseRef.current !== 'returning' || !returnArmed.current) return
    returnArmed.current = false
    setSourceVisible(true)
    // Keep the returning image above the restored source for one full frame.
    handoffFrame.current = requestAnimationFrame(() => {
      setReturnRect(null)
      setPhase('idle')
      setActive(false)
    })
  }, [])
  const close = useCallback(() => {
    if (phaseRef.current === 'returning' || phaseRef.current === 'idle') return
    returnArmed.current = false
    setReturnRect(expandedMediaRef.current?.getBoundingClientRect() ?? null)
    setPhase('returning')
  }, [])
  useEffect(() => {
    if (phase !== 'returning') return undefined
    returnFrame.current = requestAnimationFrame(() => {
      setOpen(false)
      returnArmed.current = true
      const target = sourceMediaRef.current?.getBoundingClientRect()
      const from = expandedMediaRef.current?.getBoundingClientRect()
      const alreadyAtSource =
        target &&
        from &&
        ['left', 'top', 'width', 'height'].every(
          (key) =>
            Math.abs(
              (target[key as keyof DOMRect] as number) -
                (from[key as keyof DOMRect] as number)
            ) < 0.1
        )
      if (
        alreadyAtSource ||
        !target ||
        !expandedMediaRef.current ||
        reducedMotion ||
        window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ) {
        // Reduced motion resolves both representations to the same geometry.
        if (target) setReturnRect(target)
        finishReturn()
      } else {
        setReturnRect(target)
      }
    })
    return () => {
      if (returnFrame.current !== undefined)
        cancelAnimationFrame(returnFrame.current)
    }
  }, [phase, reducedMotion, finishReturn])
  useEffect(
    () => () => {
      if (handoffFrame.current !== undefined)
        cancelAnimationFrame(handoffFrame.current)
    },
    []
  )
  useEffect(() => {
    if (open && settled && phase === 'opening') setPhase('open')
  }, [open, phase, settled])
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (!mounted || !openOnMount || requested.current) return
    requested.current = true
    setPhase('opening')
    setSourceVisible(false)
    onOverlayActiveChange?.(true)
    setSettled(
      Boolean(
        reducedMotion ||
          !media ||
          window.matchMedia('(prefers-reduced-motion: reduce)').matches
      )
    )
    setActive(true)
    setOpen(true)
  }, [mounted, openOnMount, onOverlayActiveChange, reducedMotion, media])

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
        close()
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
      onOverlayActiveChange?.(false)
    }
  }, [active, onOverlayActiveChange, close])

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
        data-source-hidden={!sourceVisible ? 'true' : undefined}
        style={{ visibility: !sourceVisible ? 'hidden' : undefined }}
        className={cn(styles.trigger, className)}
        onClick={() => {
          setPhase('opening')
          setSourceVisible(false)
          onOverlayActiveChange?.(true)
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
          <span ref={sourceMediaRef} className={styles.media}>
            <motion.span
              layoutId={phase === 'returning' ? undefined : `media-${id}`}
              // The source is always static. Rejoining the shared ID after the
              // handoff must not replay the expanded projection on this image.
              transformTemplate={() => 'none'}
              transition={spring}
              style={{ display: 'block', width: '100%', height: '100%' }}
            >
              {media}
            </motion.span>
          </span>
        )}
        <SourcePrice
          className={styles.price}
          visible={sourceVisible}
          reducedMotion={reducedMotion}
        >
          {title}
        </SourcePrice>
      </button>
      {mounted &&
        createPortal(
          <>
            {phase === 'returning' && returnRect && media && (
              <motion.div
                layout={true}
                data-slot="returning-media"
                className={styles.media}
                transition={spring}
                style={{
                  position: 'fixed',
                  zIndex: 101,
                  pointerEvents: 'none',
                  left: returnRect.left,
                  top: returnRect.top,
                  width: returnRect.width,
                  height: returnRect.height,
                  opacity: 1,
                }}
                onLayoutAnimationComplete={finishReturn}
              >
                {media}
              </motion.div>
            )}
            <AnimatePresence>
              {open && (
                <div
                  className={cn(styles.overlay, overlayClassName)}
                  style={overlayStyle}
                  data-slot="listing-overlay"
                >
                  <motion.div
                    className={styles.backdrop}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{
                      duration: reducedMotion ? 0 : 0.4,
                      ease: 'easeInOut',
                    }}
                    onClick={close}
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
                          ref={expandedMediaRef}
                          layoutId={
                            phase === 'returning' ? undefined : `media-${id}`
                          }
                          style={{
                            visibility:
                              phase === 'returning' ? 'hidden' : undefined,
                          }}
                          transition={spring}
                          className={styles.media}
                          onLayoutAnimationComplete={() => {
                            if (phaseRef.current === 'opening') {
                              setSettled(true)
                              setPhase('open')
                            }
                          }}
                        >
                          {media}
                        </motion.div>
                      )}
                      {topAction && (
                        <ExpandedContentFade
                          className={styles.topAction}
                          closing={phase === 'returning'}
                          reducedMotion={reducedMotion}
                        >
                          {topAction}
                        </ExpandedContentFade>
                      )}
                      <ExpandedContentFade
                        className={styles.info}
                        closing={phase === 'returning'}
                        reducedMotion={reducedMotion}
                        entrance={true}
                      >
                        <p className={styles.price} data-slot="expanded-price">
                          {title}
                        </p>
                        <h3 id={`title-${id}`} className={styles.title}>
                          {expandedTitle}
                        </h3>
                        {children}
                      </ExpandedContentFade>
                    </ExpandableCardScrollArea>
                    <ExpandedContentFade
                      className={styles.actions}
                      closing={phase === 'returning'}
                      reducedMotion={reducedMotion}
                    >
                      <button
                        type="button"
                        className={styles.raisedButtonDanger}
                        onClick={close}
                      >
                        <span className={styles.raisedButtonDangerSurface}>
                          Close
                        </span>
                      </button>
                      {primaryAction}
                    </ExpandedContentFade>
                  </motion.div>
                </div>
              )}
            </AnimatePresence>
          </>,
          document.body
        )}
    </>
  )
}
