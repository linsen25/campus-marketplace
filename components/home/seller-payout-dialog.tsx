import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'

import styles from './profile.module.css'

export function SellerPayoutDialog({
  status,
  artifact = 'Order Request',
  onClose,
  onSettings,
}: {
  artifact?: 'Offer' | 'Order Request'
  status: 'needs_attention' | 'unset'
  onClose: () => void
  onSettings: () => void
}) {
  const attention = status === 'needs_attention'
  return (
    <FadingDialog
      className={styles.dialog}
      aria-labelledby="seller-payout-title"
      onRequestClose={onClose}
    >
      <h3 id="seller-payout-title">
        {attention ? 'Payout account needs attention' : 'Set up payouts first'}
      </h3>
      <p className={styles.caption}>
        {attention
          ? `Resolve your payout account before sending an ${artifact}.`
          : `You need a payout account before you can send an ${artifact}.`}
      </p>
      <p className={styles.caption}>
        Your payout account is used to receive funds when you sell an item.
      </p>
      <ActionRow>
        <CardAction variant="red" onClick={onClose}>
          Cancel
        </CardAction>
        <CardAction variant="green" onClick={onSettings}>
          {attention ? 'Review Payout Settings' : 'Go to Payout Settings'}
        </CardAction>
      </ActionRow>
    </FadingDialog>
  )
}
