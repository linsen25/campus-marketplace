import PulseHeart from '@/components/react-bits/pulse-heart'
import expandable from '@/components/velora/expandable-card.module.css'
import { listingConditions } from '@/lib/listing-metadata'
import type { ListingCondition } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'

import { ListingMedia } from './listing-media'
import styles from './published-listing-card.module.css'

export const listingCardRadius = 16

type Summary = {
  price: number
  title: string
  condition?: ListingCondition
  category: string
}

/** Shared markup and styles; no session, Favorite API, analytics or Listing reads. */
export function ListingCardSummary({ listing }: { listing: Summary }) {
  const condition = listingConditions.find(
    (item) => item.value === listing.condition
  )?.label
  const metadata = [condition, listing.category]
    .filter(Boolean)
    .join(' \u00b7 ')
  return (
    <span className={styles.summary}>
      <span className={styles.price}>
        {listing.price === 0 ? 'Free' : formatListingPrice(listing.price)}
      </span>
      <span className={styles.title}>{listing.title}</span>
      {metadata && <span className={styles.meta}>{metadata}</span>}
    </span>
  )
}

export function ListingFavoriteControl({
  liked,
  disabled = false,
  onChange,
}: {
  liked: boolean
  disabled?: boolean
  onChange: (liked: boolean) => void
}) {
  return (
    <PulseHeart
      appearance="image-overlay"
      liked={liked}
      disabled={disabled}
      showCount={false}
      size={26}
      corner={22}
      idleColor="#b9a9c5"
      likedColor="#d97991"
      pillColor="transparent"
      className={styles.heart}
      label={liked ? 'Remove from favorites' : 'Add to favorites'}
      onChange={onChange}
    />
  )
}

/** Static consumer of the real collapsed presentation. The caller owns demo state. */
export function ListingCardPreview({
  listing,
  favorite,
  onFavorite,
}: {
  listing: Summary & { photoUrls: readonly string[] }
  favorite: boolean
  onFavorite: (liked: boolean) => void
}) {
  return (
    <article
      className={styles.shell}
      data-listing-card-preview="true"
      aria-label={listing.title}
    >
      <div
        className={`${expandable.trigger} ${styles.card}`}
        style={{ cursor: 'default', borderRadius: listingCardRadius }}
      >
        <span
          className={expandable.media}
          style={{ borderRadius: listingCardRadius }}
        >
          <ListingMedia
            images={listing.photoUrls.slice(0, 1)}
            alt={listing.title}
          />
        </span>
        <span className={expandable.price}>
          <ListingCardSummary listing={listing} />
        </span>
      </div>
      <div className={styles.favorite}>
        <ListingFavoriteControl liked={favorite} onChange={onFavorite} />
      </div>
    </article>
  )
}
