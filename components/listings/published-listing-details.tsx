import { listingConditions } from '@/lib/listing-metadata'
import { isMarketPair } from '@/lib/market-taxonomy'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'

import styles from './published-listing-card.module.css'

/** Public-card details only. Form, Messages and legacy Request previews retain ListingDetails. */
export function PublishedListingDetails({ listing }: { listing: Listing }) {
  const condition = listingConditions.find(
    (item) => item.value === listing.condition
  )?.label
  const meeting = listing.preferredFulfillment === 'ON_CAMPUS'
  const delivery = listing.preferredFulfillment === 'DELIVERY'
  const payment = listing.preferredPaymentMode
    ? { uu_pay: 'UU Pay', external: 'Pay outside UU' }[
        listing.preferredPaymentMode
      ]
    : null
  return (
    <div className={styles.details}>
      <section aria-label="Seller">
        <h4>Seller</h4>
        <p>{listing.seller.displayName}</p>
      </section>
      <section aria-label="Item details">
        <h4>Item details</h4>
        <dl>
          {condition && (
            <>
              <dt>Condition</dt>
              <dd>{condition}</dd>
            </>
          )}
          {listing.category && (
            <>
              <dt>Category</dt>
              <dd>{listing.category}</dd>
            </>
          )}
          {isMarketPair(listing.category, listing.subcategory) && (
            <>
              <dt>Subcategory</dt>
              <dd>{listing.subcategory}</dd>
            </>
          )}
        </dl>
      </section>
      {listing.description?.trim() && (
        <section aria-label="Description">
          <h4>Description</h4>
          <p className={styles.description}>{listing.description}</p>
        </section>
      )}
      {(payment || meeting || delivery) && (
        <section aria-label="Exchange preferences">
          <h4>Exchange preferences</h4>
          <dl>
            {payment && (
              <>
                <dt>Payment</dt>
                <dd>{payment}</dd>
              </>
            )}
            {(meeting || delivery) && (
              <>
                <dt>Fulfillment</dt>
                <dd>{meeting ? 'Meeting' : 'Delivery'}</dd>
              </>
            )}
            {meeting && listing.meetingLocation?.label?.trim() && (
              <>
                <dt>Meeting location</dt>
                <dd>{listing.meetingLocation.label}</dd>
              </>
            )}
            {delivery && listing.estimatedDeliveryFeeCents !== undefined && (
              <>
                <dt>Delivery estimate</dt>
                <dd>{formatListingPrice(listing.estimatedDeliveryFeeCents)}</dd>
              </>
            )}
          </dl>
        </section>
      )}
    </div>
  )
}
