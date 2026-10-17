import { useEffect, useRef, useState } from 'react'

import marketStyles from '@/components/listings/market-layout.module.css'
import { MarketListingFeed } from '@/components/listings/market-listing-feed'
import { PublishedListingCard } from '@/components/listings/published-listing-card'
import { useMarketScroll } from '@/hooks/use-market-scroll'
import type { PublicShop } from '@/types/shop'

import { ShopProBadge } from './shop-pro-badge'
import styles from './shop.module.css'

export function ShopPage({ shop, listings }: PublicShop) {
  const [isApp, setIsApp] = useState(false)
  const [page, setPage] = useState(1)
  const start = useRef<HTMLDivElement>(null)
  const { animateTo, cancel } = useMarketScroll()
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
        <header className={styles.heading}>
          <div className={styles.headingRow}>
            <h1>{shop.shopName}</h1>
            <ShopProBadge />
          </div>
          <p className={styles.category}>{shop.category}</p>
          <p>{shop.description}</p>
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
              pageNumber={page}
              onChangePage={(next) => {
                setPage(next)
                returnToTop()
              }}
              onReturnToTop={returnToTop}
            />
          ) : (
            <p className={styles.empty}>No active listings right now.</p>
          )}
        </div>
      </div>
    </main>
  )
}
