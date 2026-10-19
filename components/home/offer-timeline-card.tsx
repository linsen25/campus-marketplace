import { ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { offerAmount } from '@/lib/offer-amount'

import styles from './offer-ui.module.css'
import requestStyles from './order-request-preview.module.css'

/** Pure timeline presentation. Real OfferCard retains status decisions, dialog and mutations. */
export function OfferTimelineCard({
  id,
  own,
  direction,
  status,
  positive,
  amountCents,
  fields,
  counter = false,
  onOpen,
  children,
}: {
  id: string
  own: boolean
  direction: 'Buyer' | 'Seller'
  status: string
  positive: boolean
  amountCents: number
  fields: readonly string[]
  counter?: boolean
  onOpen?: () => void
  children?: ReactNode
}) {
  return (
    <div
      className={styles.timelineCard}
      data-offer-own={own}
      data-offer-id={id}
      data-offer-status={status}
    >
      <div className={`${requestStyles.collapsed} ${styles.offerButton}`}>
        <button
          type="button"
          className={styles.offerBody}
          aria-label={`Open ${direction} Offer: ${status}`}
          onClick={onOpen}
        >
          <span>
            <small>
              {direction} · {counter ? 'Counter Offer' : 'Offer'}
            </small>
            <strong>{offerAmount(amountCents)}</strong>
            {fields.length > 0 && (
              <small>
                Changed: {fields.slice(0, 3).join(' · ')}
                {fields.length > 3 ? ` · +${fields.length - 3} more` : ''}
              </small>
            )}
          </span>
        </button>
        <button
          type="button"
          className={styles.detailArrow}
          data-withdraw-exempt={true}
          aria-label={`View ${direction} Offer details`}
          onClick={onOpen}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>
      <span
        className={`${styles.offerStatus} ${
          positive ? '' : styles.offerStatusClosed
        }`}
      >
        {status}
      </span>
      {children}
    </div>
  )
}
