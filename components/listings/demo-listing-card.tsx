import { useCallback, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { ExpandableCard } from '@/components/velora/expandable-card'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'

import {
  ListingCardSummary,
  ListingFavoriteControl,
  listingCardRadius,
} from './listing-card-presentation'
import { ListingMedia } from './listing-media'
import styles from './published-listing-card.module.css'
import { PublishedListingDetails } from './published-listing-details'

/** Demo-safe adapter of the real Listing presentation. No session/API/Favorite/view hooks. */
export function DemoListingCard({
  listing,
  categoryLabel,
  favorite,
  onFavorite,
  onOverlayActiveChange,
  overlayClassName,
  overlayStyle,
}: {
  listing: Listing
  categoryLabel: string
  favorite: boolean
  onFavorite: (value: boolean) => void
  onOverlayActiveChange?: (value: boolean) => void
  overlayClassName?: string
  overlayStyle?: CSSProperties
}) {
  const [expanded, setExpanded] = useState(false)
  const callback = useRef(onOverlayActiveChange)
  callback.current = onOverlayActiveChange
  const changed = useCallback((value: boolean) => {
    setExpanded(value)
    callback.current?.(value)
  }, [])
  const heart = (
    <ListingFavoriteControl liked={favorite} onChange={onFavorite} />
  )
  return (
    <div className={styles.shell} data-demo-listing={listing.id}>
      <ExpandableCard
        title={formatListingPrice(listing.price)}
        expandedTitle={listing.title}
        visualRadius={listingCardRadius}
        className={styles.card}
        renderCloseAction={(close) => (
          <ShiningButton
            variant="red"
            desktopAppearance={true}
            showArrow={false}
            onClick={close}
          >
            Close
          </ShiningButton>
        )}
        collapsedContent={
          <ListingCardSummary
            listing={{ ...listing, category: categoryLabel }}
          />
        }
        media={
          <ListingMedia
            images={listing.photoUrls.slice(0, 1)}
            alt={listing.title}
          />
        }
        expandedMedia={
          <ListingMedia images={listing.photoUrls} alt={listing.title} />
        }
        overlayClassName={overlayClassName}
        overlayStyle={overlayStyle}
        topAction={heart}
        onOverlayActiveChange={changed}
      >
        <p>Local demo listing</p>
        <PublishedListingDetails listing={listing} />
      </ExpandableCard>
      {!expanded && <div className={styles.favorite}>{heart}</div>}
    </div>
  )
}
