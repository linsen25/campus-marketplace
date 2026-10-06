import { useEffect, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { useAuthModal } from '@/components/auth/auth-modal'
import PulseHeart from '@/components/react-bits/pulse-heart'
import { ExpandableCard } from '@/components/velora/expandable-card'
import { favoriteState, setFavorite } from '@/lib/favorites-api'
import { listingConditions } from '@/lib/listing-metadata'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'

import detailStyles from './homepage-listing-demo.module.css'
import { ListingMedia } from './listing-media'
import { useMarketplaceSession } from './marketplace-session'

export function ListingDetails({ listing }: { listing: Listing }) {
  return (
    <div className={detailStyles.details}>
      <p>Location: {listing.pickupArea || 'Choose a place'}</p>
      <h4>Seller</h4>
      <p>{listing.seller.displayName || 'You'}</p>
      <dl className={detailStyles.metadata}>
        <dt>Condition</dt>
        <dd>
          {listingConditions.find((item) => item.value === listing.condition)
            ?.label || 'Not specified'}
        </dd>
        <dt>Category</dt>
        <dd>{listing.category || 'Choose a category'}</dd>
        <dt>Subcategory</dt>
        <dd>{listing.subcategory || 'Choose a subcategory'}</dd>
      </dl>
      <h4>Description</h4>
      <p className={detailStyles.description}>
        {listing.description || 'Add a description'}
      </p>
    </div>
  )
}

/** One accepted Market card for public browsing, Favorites, and seller history. */
export function PublishedListingCard({
  listing,
  owner = false,
  initiallyFavorited = false,
  onUnfavorite,
  onOverlayActiveChange,
  overlayClassName,
  overlayStyle,
}: {
  listing: Listing
  owner?: boolean
  initiallyFavorited?: boolean
  onUnfavorite?: (id: string) => void
  onOverlayActiveChange?: (active: boolean) => void
  overlayClassName?: string
  overlayStyle?: React.CSSProperties
}) {
  const { seller } = useMarketplaceSession()
  const own = owner || seller?.id === listing.seller.id
  const { openAuth } = useAuthModal()
  const [favorite, setFavorited] = useState(initiallyFavorited)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [contact, setContact] = useState(false)
  const [photoIndex, setPhotoIndex] = useState(0)
  useEffect(() => {
    if (!seller || own || initiallyFavorited) return undefined
    let active = true
    favoriteState(listing.id)
      .then((result) => {
        if (active) setFavorited(result.favorited)
      })
      .catch(() => {
        if (active) setError('Favorites unavailable. Try again.')
      })
    return () => {
      active = false
    }
  }, [listing.id, seller, own, initiallyFavorited])
  async function toggle(liked: boolean) {
    if (busy) return
    if (!seller) {
      openAuth({ mode: 'signin', intent: 'login' })
      return
    }
    setBusy(true)
    setError('')
    try {
      const result = await setFavorite(listing.id, liked)
      setFavorited(result.favorited)
      if (!result.favorited) onUnfavorite?.(listing.id)
      window.dispatchEvent(new Event('marketplace-listings-changed'))
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to update favorites.'
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <ExpandableCard
      title={listing.price === 0 ? 'Free' : formatListingPrice(listing.price)}
      expandedTitle={listing.title}
      media={
        <ListingMedia
          images={listing.photoUrls}
          alt={listing.title}
          activeIndex={photoIndex}
          onIndexChange={setPhotoIndex}
        />
      }
      interactiveMedia={listing.photoUrls.length > 1}
      overlayClassName={overlayClassName}
      overlayStyle={overlayStyle}
      topAction={
        !own && listing.status === 'available' ? (
          <PulseHeart
            liked={favorite}
            disabled={busy}
            showCount={false}
            size={26}
            corner={22}
            idleColor="#b9a9c5"
            likedColor="#d97991"
            pillColor="transparent"
            label={favorite ? 'Remove from favorites' : 'Add to favorites'}
            onChange={(liked) => toggle(liked)}
          />
        ) : undefined
      }
      primaryAction={
        !own && listing.status === 'available' ? (
          <ShiningButton
            variant="green"
            desktopAppearance={true}
            onClick={() => {
              if (!seller)
                openAuth({ mode: 'signin', intent: 'contact-seller' })
              else setContact(true)
            }}
          >
            Contact seller
          </ShiningButton>
        ) : undefined
      }
      onOverlayActiveChange={onOverlayActiveChange}
    >
      <ListingDetails listing={listing} />
      {contact && <p role="status">Messaging is coming later.</p>}
      {error && <p role="alert">{error}</p>}
    </ExpandableCard>
  )
}
