// Adapted from Velora UI's Stepper: https://velora.colorlib.com/components/stepper
// Copyright (c) 2026 Aigars Silkalns. MIT; see stepper.LICENSE.txt.
// Retains current/(count-1), completed checks and reduced-motion track fill.
import { motion, useReducedMotion } from 'motion/react'
import type { CSSProperties } from 'react'

import styles from './stepper.module.css'

export function Stepper({
  steps,
  current,
  terminal = false,
  readableMobile = false,
  completed,
}: {
  steps: readonly string[]
  current: number | null
  terminal?: boolean
  readableMobile?: boolean
  completed?: number
}) {
  const reduced = useReducedMotion()
  const done = Math.max(0, Math.min(completed ?? current ?? 0, steps.length))
  const active = Math.max(0, Math.min(current ?? done - 1, steps.length - 1))
  const progress = steps.length > 1 ? active / (steps.length - 1) : 0
  return (
    <div
      className={styles.root}
      data-slot="stepper"
      data-readable-mobile={readableMobile || undefined}
      style={
        {
          '--step-count': steps.length,
          '--step-progress': progress,
        } as CSSProperties
      }
    >
      <div className={styles.track} aria-hidden="true">
        <motion.div
          className={styles.fill}
          initial={false}
          animate={{ scaleX: progress }}
          transition={{ duration: reduced ? 0 : 0.4, ease: 'easeOut' }}
        />
      </div>
      <ol className={styles.steps} aria-label="Order progress">
        {steps.map((step, index) => {
          let state = 'Inactive'
          if (index < done) state = 'Completed'
          else if (!terminal && current !== null && index === active)
            state = 'Current'
          return (
            <li
              key={step}
              className={styles.step}
              data-done={index < done || undefined}
              aria-current={
                !terminal && current !== null && index === active
                  ? 'step'
                  : undefined
              }
              aria-label={`${step}: ${state}`}
            >
              <span className={styles.marker} aria-hidden="true">
                {index < done ? (
                  <svg
                    width="13"
                    height="13"
                    viewBox="0 0 14 14"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.25"
                  >
                    <path d="M2.5 7.5l3 3 6-6" />
                  </svg>
                ) : (
                  index + 1
                )}
              </span>
              <span className={styles.label}>{step}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
