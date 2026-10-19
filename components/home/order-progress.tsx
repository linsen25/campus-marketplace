import { Check } from 'lucide-react'
import type { CSSProperties } from 'react'

import styles from './order-detail-preview.module.css'
import timeline from './order-progress.module.css'
import profile from './profile.module.css'

const pickupSteps = [
  'Order accepted',
  'Payment',
  'Awaiting handoff',
  'Handoff confirmed',
  'Completed',
]
const shippingSteps = [
  'Order accepted',
  'Payment',
  'Ready to ship',
  'Shipped',
  'Delivered',
  'Completed',
]

/** Presentation only. The caller supplies authoritative or isolated-preview progress. */
export function OrderProgress({
  shipping,
  current,
  steps,
  terminal = false,
  completed,
  dates,
  terminalLabel = 'Reservation expired',
}: {
  shipping?: boolean
  current: number | null
  steps?: readonly string[]
  terminal?: boolean
  completed?: number
  dates?: ReadonlyArray<string | null | undefined>
  terminalLabel?: string
}) {
  const labels = steps || (shipping ? shippingSteps : pickupSteps)
  const done = Math.max(0, Math.min(completed ?? current ?? 0, labels.length))
  return (
    <section
      className={`${profile.panel} ${styles.progress}`}
      aria-label="Order Progress"
    >
      <h4>Order Progress</h4>
      {terminal && <p role="status">{terminalLabel}</p>}
      <ol
        className={timeline.steps}
        aria-label="Order progress"
        data-slot="stepper"
        style={{ '--step-count': labels.length } as CSSProperties}
      >
        {labels.map((label, index) => {
          const finished = index < done
          const active = !terminal && current !== null && index === current
          const date = finished && dates?.[index]
          let state = 'Inactive'
          if (finished) state = 'Completed'
          else if (active) state = 'Current'
          return (
            <li
              key={label}
              className={timeline.step}
              data-done={finished || undefined}
              aria-current={active ? 'step' : undefined}
              aria-label={`${label}: ${state}`}
            >
              <span className={timeline.marker} aria-hidden="true">
                {finished ? <Check size={16} /> : index + 1}
              </span>
              <span className={timeline.label}>{label}</span>
              {date && !Number.isNaN(Date.parse(date)) && (
                <time className={timeline.date} dateTime={date}>
                  {new Date(date).toLocaleDateString('en-CA', {
                    timeZone: 'America/Toronto',
                    month: 'short',
                    day: 'numeric',
                  })}
                </time>
              )}
            </li>
          )
        })}
      </ol>
    </section>
  )
}
