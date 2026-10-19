import type { Listing } from '@/types/listing'

import styles from './listing-workspace.module.css'
import { PublishedListingCard } from './published-listing-card'
import { ResaleManagementCard } from './resale-management-card'

/** Existing owner presentation only. Parent retains state, API and confirmations. */
export function ManagedListingCard({
  listing,
  resale = false,
  onEdit,
  onMarkSold,
  onDelete,
}: {
  listing: Listing
  resale?: boolean
  onEdit: () => void
  onMarkSold: () => void
  onDelete: () => void
}) {
  if (resale)
    return (
      <ResaleManagementCard
        listing={listing}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    )
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
