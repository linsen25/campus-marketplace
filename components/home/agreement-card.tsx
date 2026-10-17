import { DynamicAction } from '@/components/ui/dynamic-action'
import { offerAmount } from '@/lib/offer-amount'
import type { Agreement } from '@/types/offer'

import styles from './offer-ui.module.css'

export function AgreementCard({
  agreement,
  onView,
}: {
  agreement: Agreement
  onView: () => void
}) {
  if (agreement.status === 'cancelled')
    return (
      <p className={styles.cancelledEvent} data-agreement-status="cancelled">
        Order cancelled
      </p>
    )
  const terms = agreement.terms
  let fulfillment = 'Meeting'
  let summary = ''
  if (terms.fulfillment === 'on_campus')
    summary = `${terms.meetupLocation} · ${new Date(
      terms.scheduledAt
    ).toLocaleString('en-CA', {
      timeZone: 'America/Toronto',
      dateStyle: 'medium',
      timeStyle: 'short',
    })}`
  else {
    fulfillment =
      terms.deliveryMethod === 'courier' ? 'Courier' : 'Seller delivery'
    if (terms.deliveryArea)
      summary = `${terms.deliveryArea.cityLabel}, ${terms.deliveryArea.provinceCode} · ${terms.deliveryArea.postalPrefix}`
  }
  const active = agreement.status === 'open'
  const title = active
    ? 'Agreement reached'
    : agreement.status.charAt(0).toUpperCase() + agreement.status.slice(1)
  return (
    <div
      className={styles.agreementItem}
      data-agreement-status={agreement.status}
    >
      <span
        className={`${styles.offerStatus} ${styles.agreementStatus} ${
          active || agreement.status === 'completed'
            ? ''
            : styles.offerStatusClosed
        }`}
      >
        {title}
      </span>
      <div className={styles.agreement}>
        <div className={styles.agreementInfo}>
          <p>{agreement.listingTitle}</p>
          <p>
            {offerAmount(terms.itemAmountCents)} · {fulfillment}
          </p>
          <p>{summary}</p>
          {terms.paymentMode === 'external' && (
            <p>Paid outside UU · No UU payment protection</p>
          )}
        </div>
        <DynamicAction
          variant="blue"
          className={styles.agreementCta}
          onClick={onView}
        >
          {active ? 'View Order' : 'View details'}
        </DynamicAction>
      </div>
    </div>
  )
}
