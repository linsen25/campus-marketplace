import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'

import styles from './profile.module.css'

export function PaymentUnavailableDialog({
  onClose,
  onContact,
  busy = false,
}: {
  onClose: () => void
  onContact: () => void
  busy?: boolean
}) {
  return (
    <FadingDialog
      className={styles.dialog}
      aria-labelledby="payment-unavailable-title"
      onRequestClose={onClose}
    >
      <h3 id="payment-unavailable-title">Payment isn&apos;t available yet</h3>
      <p className={styles.caption}>
        The seller hasn&apos;t finished setting up their payout account. Please
        try again later or contact the seller.
      </p>
      <ActionRow>
        <CardAction variant="red" onClick={onClose} disabled={busy}>
          Close
        </CardAction>
        <CardAction variant="green" onClick={onContact} disabled={busy}>
          {busy ? 'Opening conversation…' : 'Contact seller'}
        </CardAction>
      </ActionRow>
    </FadingDialog>
  )
}
