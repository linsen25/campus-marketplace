import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'

import { pageSlideMotionTransition } from '@/lib/page-slide'

import styles from './stripe-flow-panel.module.css'
import { StripeFlowNavButton } from './stripe-flow-nav-button'

export function StripeFlowPanel({
  open,
  title,
  description,
  onClose,
  onExitComplete,
  confirmClose = false,
  preventScrimClose = false,
  children,
}: {
  open: boolean
  title: string
  description?: string
  onClose: () => void
  onExitComplete?: () => void
  confirmClose?: boolean
  preventScrimClose?: boolean
  children: ReactNode
}) {
  const reduced = useReducedMotion()
  const [mobile, setMobile] = useState(false)
  const [confirmingExit, setConfirmingExit] = useState(false)
  const pushedHistory = useRef(false)
  const priorFocus = useRef<HTMLElement | null>(null)
  const stayButton = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose
  const requestClose = useCallback(() => {
    if (confirmClose) {
      priorFocus.current = document.activeElement as HTMLElement | null
      setConfirmingExit(true)
      return
    }
    onCloseRef.current()
  }, [confirmClose])
  const stay = useCallback(() => {
    setConfirmingExit(false)
    if (!pushedHistory.current) {
      window.history.pushState({ stripeFlow: true }, '')
      pushedHistory.current = true
    }
    queueMicrotask(() => priorFocus.current?.focus())
  }, [])
  const exit = useCallback(() => {
    setConfirmingExit(false)
    onCloseRef.current()
  }, [])
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  useEffect(() => {
    if (!open) return undefined
    const handler = () => {
      pushedHistory.current = false
      requestClose()
    }
    window.addEventListener('popstate', handler)
    window.history.pushState({ stripeFlow: true }, '')
    pushedHistory.current = true
    return () => {
      window.removeEventListener('popstate', handler)
      if (pushedHistory.current && window.history.state?.stripeFlow) {
        pushedHistory.current = false
        window.history.back()
      }
    }
  }, [open, requestClose])
  useEffect(() => {
    if (!open) return undefined
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])
  useEffect(() => {
    if (!open) {
      setConfirmingExit(false)
      return undefined
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      if (confirmingExit) stay()
      else requestClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [confirmingExit, open, requestClose, stay])
  useEffect(() => {
    if (confirmingExit) stayButton.current?.focus()
  }, [confirmingExit])
  return (
    <AnimatePresence onExitComplete={onExitComplete}>
      {open && (
        <m.div
          className={styles.layer}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={pageSlideMotionTransition(mobile, Boolean(reduced))}
          data-stripe-flow-panel="true"
        >
          {preventScrimClose ? (
            <div
              className={styles.scrim}
              aria-hidden="true"
              data-stripe-flow-scrim="static"
            />
          ) : (
            <button
              className={styles.scrim}
              aria-label="Close"
              data-stripe-flow-scrim="dismiss"
              onClick={requestClose}
            />
          )}
          <m.section
            className={styles.panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={pageSlideMotionTransition(mobile, Boolean(reduced))}
          >
            <header className={styles.header}>
              <StripeFlowNavButton kind="back" onClick={requestClose} />
              <div>
                <h2>{title}</h2>
                {description && <p>{description}</p>}
              </div>
              <StripeFlowNavButton kind="close" onClick={requestClose} />
            </header>
            <div className={styles.body}>{children}</div>
          </m.section>
          {confirmingExit && (
            <div className={styles.confirmationLayer}>
              <section
                className={styles.confirmation}
                role="alertdialog"
                aria-modal="true"
                aria-labelledby="stripe-exit-title"
                aria-describedby="stripe-exit-description"
              >
                <h3 id="stripe-exit-title">Exit verification?</h3>
                <p id="stripe-exit-description">
                  You can return later to continue any outstanding steps with
                  Stripe.
                </p>
                <div className={styles.confirmationActions}>
                  <button ref={stayButton} type="button" onClick={stay}>
                    Stay
                  </button>
                  <button type="button" onClick={exit}>
                    Exit
                  </button>
                </div>
              </section>
            </div>
          )}
        </m.div>
      )}
    </AnimatePresence>
  )
}
