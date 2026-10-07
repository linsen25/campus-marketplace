import ShiningButton from '@/components/animata/button/shining-button'
import { ListingMedia } from '@/components/listings/listing-media'
import { ListingDetails } from '@/components/listings/published-listing-card'
import { ExpandedCardPreview } from '@/components/velora/expandable-card'
import type { ChatListing } from '@/types/conversation'
import { formatListingPrice } from '@/utils/format-listing-price'

import workspaceStyles from '../listings/listing-workspace.module.css'
import actionStyles from '../listings/market-filter.module.css'

import styles from './messages-listing-preview.module.css'

const visualOnly = () => undefined

export function MessagesListingPreview({
  listing,
  destination,
  onCancel,
}: {
  listing: ChatListing
  destination: string
  onCancel: () => void
}) {
  return (
    <ExpandedCardPreview
      className={`${workspaceStyles.inlinePreview} ${styles.card}`}
      title={formatListingPrice(listing.price)}
      expandedTitle={listing.title}
      media={
        listing.photoUrls.length ? (
          <ListingMedia images={listing.photoUrls} alt={listing.title} />
        ) : (
          <span className={workspaceStyles.photoPlaceholder}>
            No photo available
          </span>
        )
      }
      actions={
        <div className={`${actionStyles.actions} ${styles.actions}`}>
          <button
            type="button"
            className={actionStyles.cancel}
            onClick={onCancel}
          >
            <span>Cancel</span>
          </button>
          <ShiningButton
            variant="green"
            desktopAppearance={true}
            onClick={visualOnly}
          >
            {destination === 'selling' ? 'Send to buyer' : 'Send to seller'}
          </ShiningButton>
        </div>
      }
    >
      {listing.live ? (
        <ListingDetails listing={listing.live} />
      ) : (
        <div>
          <p>{listing.category}</p>
          <p>
            {listing.availability === 'deleted'
              ? 'This listing was deleted. Its original details are retained for this conversation.'
              : 'This listing is no longer publicly available.'}
          </p>
        </div>
      )}
    </ExpandedCardPreview>
  )
}
