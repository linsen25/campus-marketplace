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
  const terms = agreement.terms
  let fulfillment = 'On Campus'
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
    <div className={styles.agreement} data-agreement-status={agreement.status}>
      <strong>{title}</strong>
      <p>{agreement.listingTitle}</p>
      <p>
        {offerAmount(terms.itemAmountCents)} · {fulfillment}
      </p>
      <p>{summary}</p>
      <button type="button" onClick={onView}>
        {active ? 'View Order' : 'View details'}
      </button>
    </div>
  )
}
