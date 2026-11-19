import { Check, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import styles from './auth-success-reveal.module.css'

const labels = [
  'Verifying your account',
  'Loading your profile',
  'Preparing your marketplace',
  'Opening Usual & Unusual',
]
const readableStepDelay = 220
const completionHold = 200

export function SuccessThoughtLine({
  destinationReady,
  profileReady,
  reduced,
  startedAt,
  readyAt,
  onComplete,
}: {
  destinationReady: boolean
  profileReady: boolean
  reduced: boolean
  startedAt: number
  readyAt: number | null
  onComplete: () => void
}) {
  const [boundary, setBoundary] = useState(0)
  const [visibleBoundary, setVisibleBoundary] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const lastUpdate = useRef(performance.now())
  const completionStarted = useRef(false)
  useEffect(() => {
    const inspect = () => {
      const root = document.querySelector<HTMLElement>(
        '[data-market-preparation]'
      )
      const stage = root?.dataset.marketPreparation
      // The destination owns this marker. Only a committed first paint means
      // that marketplace preparation itself is complete; mounting the root or
      // beginning asset work must not create a misleading completed check.
      if (stage === 'paint') setBoundary(3)
    }
    const observer = new MutationObserver(inspect)
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['data-market-preparation'],
    })
    inspect()
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    const paint = () =>
      setElapsed(
        Math.max(0, ((readyAt ?? performance.now()) - startedAt) / 1000)
      )
    paint()
    if (readyAt !== null) return undefined
    const timer = setInterval(paint, 100)
    return () => clearInterval(timer)
  }, [startedAt, readyAt])
  // The overlay is mounted only after authentication has succeeded. Profile
  // readiness comes from the cookie-backed session refresh, and the remaining
  // boundaries come from the destination's paint handshake and final promise.
  const actualBoundary = destinationReady
    ? 4
    : Math.max(1, profileReady ? 2 : 1, boundary)
  useEffect(() => {
    if (visibleBoundary >= actualBoundary) return undefined
    // A short floor only spaces already reached real boundaries. It never
    // marks an operation complete before its source signal has arrived.
    const timer = setTimeout(
      () => {
        lastUpdate.current = performance.now()
        setVisibleBoundary((current) => current + 1)
      },
      reduced
        ? 0
        : Math.max(
            0,
            readableStepDelay - (performance.now() - lastUpdate.current)
          )
    )
    return () => clearTimeout(timer)
  }, [actualBoundary, visibleBoundary, reduced])
  useEffect(() => {
    if (
      visibleBoundary !== labels.length ||
      !destinationReady ||
      completionStarted.current
    )
      return undefined
    completionStarted.current = true
    const timer = setTimeout(onComplete, reduced ? 0 : completionHold)
    return () => clearTimeout(timer)
  }, [visibleBoundary, destinationReady, onComplete, reduced])
  return (
    <div className={styles.thoughtLine}>
      <div className={styles.thoughtHeader} data-thought-header="true">
        <Sparkles size={16} aria-hidden="true" />
        <span>Loading Usual & Unusual{destinationReady ? '' : '...'}</span>
        <span className={styles.elapsed} data-loading-timer="true">
          {elapsed.toFixed(1)}s
        </span>
      </div>
      <ol
        className={styles.thoughtSteps}
        aria-label="Usual & Unusual loading progress"
      >
        {labels
          .slice(0, Math.min(visibleBoundary + 1, 4))
          .map((label, index) => {
            const state = index < visibleBoundary ? 'complete' : 'active'
            return (
              <motion.li
                key={label}
                className={styles.step}
                data-loading-step={index}
                data-state={state}
                aria-current={state === 'active' ? 'step' : undefined}
                initial={reduced ? false : { opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}
              >
                <span className={styles.statusMark} aria-hidden="true">
                  {state === 'complete' ? (
                    <Check size={14} strokeWidth={2.5} />
                  ) : (
                    <i className={styles.pulse} />
                  )}
                </span>
                <span>{label}</span>
                <span className={styles.srOnly}>{state}</span>
              </motion.li>
            )
          })}
      </ol>
    </div>
  )
}
