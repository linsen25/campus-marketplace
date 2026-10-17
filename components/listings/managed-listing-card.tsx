import type { Listing } from '@/types/listing'

import styles from './listing-workspace.module.css'
import { PublishedListingCard } from './published-listing-card'

/** Existing owner presentation only. Parent retains state, API and confirmations. */
export function ManagedListingCard({
  listing,
  onEdit,
  onMarkSold,
  onDelete,
}: {
  listing: Listing
  onEdit: () => void
  onMarkSold: () => void
  onDelete: () => void
}) {
  return (
    <article aria-label={listing.title}>
      <PublishedListingCard listing={listing} owner={true} />
      {listing.status === 'available' ? (
        <div className={styles.sellerActions}>
          <button type="button" onClick={onEdit}>
            Edit
          </button>
          <button type="button" onClick={onMarkSold}>
            Mark as sold
          </button>
          <button type="button" onClick={onDelete}>
            Delete
          </button>
        </div>
      ) : (
        <p>
          {
            {
              pending: 'Pending transaction',
              reserved: 'Reserved',
              sold: 'Sold',
              available: 'Available',
            }[listing.status]
          }{' '}
          · Read-only
        </p>
      )}
    </article>
  )
}
