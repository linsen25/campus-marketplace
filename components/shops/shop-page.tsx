import { useEffect, useRef, useState } from 'react'

import marketStyles from '@/components/listings/market-layout.module.css'
import { MarketListingFeed } from '@/components/listings/market-listing-feed'
import { MarketPagination } from '@/components/listings/market-pagination'
import { PublishedListingCard } from '@/components/listings/published-listing-card'
import PulseHeart from '@/components/react-bits/pulse-heart'
import { useMarketScroll } from '@/hooks/use-market-scroll'
import { usePublicShopRead } from '@/hooks/use-public-shop-read'
import { useShopFavorite } from '@/hooks/use-shop-favorites'
import { readPublicShop } from '@/lib/public-shop-api'
import type { PublicShop } from '@/types/shop'

import { ShopProBadge } from './shop-pro-badge'
import styles from './shop.module.css'

export function ShopPage(initial: PublicShop) {
  const favorite = useShopFavorite(initial.shop.id)
  const [isApp, setIsApp] = useState(false)
  const [page, setPage] = useState(1)
  const start = useRef<HTMLDivElement>(null)
  const { animateTo, cancel } = useMarketScroll()
  const result = usePublicShopRead(
    `${initial.shop.username}:${page}`,
    (signal) =>
      readPublicShop(initial.shop.username, { page, pageSize: 15 }, signal),
    { ...initial, state: 'available' as const }
  )
  const data = result.data?.state === 'available' ? result.data : undefined
  const shop = data?.shop || initial.shop
  const listings = data?.listings || []
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const update = () => setIsApp(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const returnToTop = () => {
    cancel()
    if (start.current)
      animateTo(window.scrollY + start.current.getBoundingClientRect().top)
  }
  return (
    <main className={styles.surface}>
      <div className={`${marketStyles.content} ${styles.page}`}>
        {result.error && (
          <p role="alert">
            {result.error}{' '}
            <button type="button" onClick={() => result.retry()}>
              Retry
            </button>
          </p>
        )}
        {result.loading && <p role="status">Loading Shop...</p>}
        {result.data?.state === 'unavailable' && (
          <p role="status">This shop is temporarily unavailable.</p>
        )}
        {result.data?.state === 'not_found' && (
          <p role="status">Shop not found.</p>
        )}
        {data && (
          <>
            <header className={styles.heading}>
              <div className={styles.headingRow}>
                <h1>{shop.shopName}</h1>
                {shop.badgeTier && <ShopProBadge tier={shop.badgeTier} />}
                <div className="ml-auto shrink-0">
                  <PulseHeart
                    confirmOnChange={true}
                    appearance="image-overlay"
                    size={26}
                    showCount={false}
                    likedColor="#d97991"
                    idleColor="#4d574d"
                    pillColor="transparent"
                    liked={favorite.liked}
                    disabled={favorite.disabled}
                    label={`${
                      favorite.liked ? 'Unfavorite' : 'Favorite'
                    } shop: ${shop.shopName}`}
                    onChange={(value) => favorite.change(value)}
                  />
                </div>
              </div>
              <p className={styles.category}>{shop.category}</p>
              <p>{shop.description}</p>
              {favorite.error && (
                <p role="alert">
                  {favorite.error}{' '}
                  <button type="button" onClick={() => favorite.retry()}>
                    Retry
                  </button>
                </p>
              )}
            </header>
            <div ref={start}>
              {listings.length ? (
                <MarketListingFeed
                  isApp={isApp}
                  feedKey={shop.username}
                  items={listings.map((listing) => ({
                    id: listing.id,
                    title: listing.title,
                    customContent: <PublishedListingCard listing={listing} />,
                  }))}
                  pageNumber={1}
                  onChangePage={() => undefined}
                  onReturnToTop={returnToTop}
                />
              ) : (
                <p className={styles.empty}>No active listings right now.</p>
              )}
            </div>
            {(page > 1 || data.hasNextPage) && (
              <MarketPagination
                page={page}
                pageCount={page + (data.hasNextPage ? 1 : 0)}
                unknownTotal={Boolean(data.hasNextPage)}
                onChange={(next) => {
                  setPage(next)
                  returnToTop()
                }}
                onReturnToTop={returnToTop}
              />
            )}
          </>
        )}
      </div>
    </main>
  )
}
