import { Stepper } from '@/components/velora/stepper'

import styles from './order-detail-preview.module.css'
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
  terminalLabel = 'Reservation expired',
}: {
  shipping?: boolean
  current: number | null
  steps?: readonly string[]
  terminal?: boolean
  completed?: number
  terminalLabel?: string
}) {
  return (
    <section
      className={`${profile.panel} ${styles.progress}`}
      aria-label="Order Progress"
    >
      <h4>Order Progress</h4>
      {terminal && <p role="status">{terminalLabel}</p>}
      <Stepper
        steps={steps || (shipping ? shippingSteps : pickupSteps)}
        current={current}
        terminal={terminal}
        completed={completed}
        readableMobile={Boolean(steps)}
      />
    </section>
  )
}
