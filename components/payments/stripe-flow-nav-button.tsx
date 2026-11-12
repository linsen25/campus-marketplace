import { ArrowLeft, X } from 'lucide-react'
import type { ButtonHTMLAttributes } from 'react'

import styles from './stripe-flow-panel.module.css'

export function StripeFlowNavButton({
  kind,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  kind: 'back' | 'close'
}) {
  const Icon = kind === 'back' ? ArrowLeft : X
  return (
    <button
      {...props}
      className={kind === 'back' ? styles.back : styles.close}
      aria-label={props['aria-label'] || (kind === 'back' ? 'Back' : 'Close')}
      type={props.type || 'button'}
    >
      <Icon size={20} aria-hidden="true" />
    </button>
  )
}
