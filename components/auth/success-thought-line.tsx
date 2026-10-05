import { Check, Sparkles } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'

import styles from './auth-success-reveal.module.css'

const labels = [
  'Opening Marketplace',
  'Preparing listings',
  'Loading listing cards',
  'Getting everything ready',
]

export function SuccessThoughtLine({
  destinationReady,
  reduced,
  startedAt,
  readyAt,
  onComplete,
}: {
  destinationReady: boolean
  reduced: boolean
  startedAt: number
  readyAt: number | null
  onComplete: () => void
}) {
  const [boundary, setBoundary] = useState(0)
  const [visibleBoundary, setVisibleBoundary] = useState(0)
  const [elapsed, setElapsed] = useState(0)
  const lastUpdate = useRef(performance.now())
  useEffect(() => {
    const inspect = () => {
      const root = document.querySelector<HTMLElement>(
        '[data-market-preparation]'
      )
      const stage = root?.dataset.marketPreparation
      let current = root ? 1 : 0
      if (stage === 'assets') current = 2
      if (stage === 'paint') current = 3
      setBoundary((previous) => Math.max(previous, current))
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
  const actualBoundary = destinationReady ? 4 : boundary
  useEffect(() => {
    if (visibleBoundary >= actualBoundary) return undefined
    // Readability floor only acknowledges already reached real boundaries.
    const timer = setTimeout(
      () => {
        lastUpdate.current = performance.now()
        setVisibleBoundary((current) =>
          reduced ? actualBoundary : current + 1
        )
      },
      reduced ? 0 : Math.max(0, 180 - (performance.now() - lastUpdate.current))
    )
    return () => clearTimeout(timer)
  }, [actualBoundary, visibleBoundary, reduced])
  useEffect(() => {
    if (visibleBoundary === 4 && destinationReady) onComplete()
  }, [visibleBoundary, destinationReady, onComplete])
  return (
    <div className={styles.thoughtLine}>
      <div className={styles.thoughtHeader} data-thought-header="true">
        <Sparkles size={16} aria-hidden="true" />
        <span>Loading Marketplace{destinationReady ? '' : '...'}</span>
        <span className={styles.elapsed} data-loading-timer="true">
          {elapsed.toFixed(1)}s
        </span>
      </div>
      <ol
        className={styles.thoughtSteps}
        aria-label="Marketplace loading progress"
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
