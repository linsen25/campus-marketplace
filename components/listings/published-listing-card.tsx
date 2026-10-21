import { useCallback, useEffect, useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { useAuthModal } from '@/components/auth/auth-modal'
import { ExpandableCard } from '@/components/velora/expandable-card'
import { favoriteState, setFavorite } from '@/lib/favorites-api'
import { listingConditions } from '@/lib/listing-metadata'
import { recordMarketplaceView } from '@/lib/record-marketplace-view'
import type { Listing } from '@/types/listing'
import { formatListingPrice } from '@/utils/format-listing-price'

import detailStyles from './homepage-listing-demo.module.css'
import actionStyles from './listing-action-availability.module.css'
import {
  ListingCardSummary,
  ListingFavoriteControl,
  listingCardRadius,
} from './listing-card-presentation'
import { ListingMedia } from './listing-media'
import { useMarketplaceSession } from './marketplace-session'
import styles from './published-listing-card.module.css'
import { PublishedListingDetails } from './published-listing-details'
import { useListingOfferContext } from './use-listing-offer-context'
import { useMessageSeller } from './use-message-seller'

export function ListingDetails({ listing }: { listing: Listing }) {
  return (
    <div className={detailStyles.details}>
      {listing.meetingLocation?.label && (
        <p>Meeting location: {listing.meetingLocation.label}</p>
      )}
      {listing.preferredFulfillment === 'DELIVERY' && (
        <p>
          Estimated delivery fee:{' '}
          {formatListingPrice(listing.estimatedDeliveryFeeCents ?? 0)}
        </p>
      )}
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
  onIntentionalOpen,
  overlayClassName,
  overlayStyle,
}: {
  listing: Listing
  owner?: boolean
  initiallyFavorited?: boolean
  onUnfavorite?: (id: string) => void
  onOverlayActiveChange?: (active: boolean) => void
  onIntentionalOpen?: () => void
  overlayClassName?: string
  overlayStyle?: React.CSSProperties
}) {
  const { seller } = useMarketplaceSession()
  const own = owner || seller?.id === listing.seller.id
  const { openAuth } = useAuthModal()
  const [favorite, setFavorited] = useState(initiallyFavorited)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [overlayActive, setOverlayActive] = useState(false)
  const saving = useRef(false)
  const favoriteVersion = useRef(0)
  const overlayListener = useRef(onOverlayActiveChange)
  overlayListener.current = onOverlayActiveChange
  // Keep the dialog's lock/focus effect stable across Favorite and parent renders.
  const overlayChanged = useCallback((active: boolean) => {
    setOverlayActive(active)
    overlayListener.current?.(active)
  }, [])
  const messaging = useMessageSeller(listing.id)
  const shopReadOnly = listing.listingChannel === 'shop'
  const canInteract = !own && !shopReadOnly
  const offerContext = useListingOfferContext(
    listing.id,
    listing.seller.id,
    !shopReadOnly
  )
  useEffect(() => {
    if (!seller || own || initiallyFavorited || shopReadOnly) return undefined
    let active = true
    const version = favoriteVersion.current
    favoriteState(listing.id)
      .then((result) => {
        if (active && version === favoriteVersion.current)
          setFavorited(result.favorited)
      })
      .catch(() => {
        if (active && version === favoriteVersion.current)
          setError('Favorites unavailable. Try again.')
      })
    return () => {
      active = false
    }
  }, [listing.id, seller, own, initiallyFavorited, shopReadOnly])
  async function toggle(liked: boolean) {
    if (saving.current) return
    if (!seller) {
      openAuth({ mode: 'signin', intent: 'login' })
      return
    }
    saving.current = true
    favoriteVersion.current += 1
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
      saving.current = false
      setBusy(false)
    }
  }
  const favoriteControl =
    canInteract && listing.status === 'available' ? (
      <ListingFavoriteControl
        liked={favorite}
        disabled={busy}
        onChange={(liked) => toggle(liked)}
      />
    ) : undefined
  return (
    <div className={styles.shell} data-published-listing={listing.id}>
      <ExpandableCard
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
        visualRadius={listingCardRadius}
        collapsedContent={<ListingCardSummary listing={listing} />}
        title={listing.price === 0 ? 'Free' : formatListingPrice(listing.price)}
        expandedTitle={listing.title}
        expandedEyebrow={
          <span className={styles.expandedPriceRow}>
            <span className={styles.expandedPriceValue}>
              {listing.price === 0 ? 'Free' : formatListingPrice(listing.price)}
            </span>
            {favoriteControl && (
              <span className={styles.expandedFavorite}>{favoriteControl}</span>
            )}
          </span>
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
        overlayClassName={[styles.expandedOverlay, overlayClassName]
          .filter(Boolean)
          .join(' ')}
        overlayStyle={overlayStyle}
        primaryAction={
          canInteract ? (
            <>
              <ShiningButton
                variant="green"
                desktopAppearance={true}
                disabled={messaging.busy}
                onClick={() => messaging.contact()}
              >
                Message Seller
              </ShiningButton>
              {offerContext.enabled && (
                <div className={actionStyles.offerAction}>
                  <ShiningButton
                    variant="green"
                    desktopAppearance={true}
                    disabled={offerContext.busy || offerContext.disabled}
                    onClick={() => offerContext.open()}
                  >
                    {offerContext.label}
                  </ShiningButton>
                  {offerContext.reason && (
                    <p className={actionStyles.reason}>{offerContext.reason}</p>
                  )}
                </div>
              )}
            </>
          ) : undefined
        }
        onOverlayActiveChange={overlayChanged}
        onIntentionalOpen={
          own
            ? undefined
            : () => {
                if (seller) recordMarketplaceView(listing.id)
                onIntentionalOpen?.()
              }
        }
      >
        <PublishedListingDetails listing={listing} />
        {messaging.error && <p role="alert">{messaging.error}</p>}
        {offerContext.error && <p role="alert">{offerContext.error}</p>}
        {error && <p role="alert">{error}</p>}
      </ExpandableCard>
      {!overlayActive && favoriteControl && (
        <div className={styles.favorite}>{favoriteControl}</div>
      )}
      {!overlayActive && error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
