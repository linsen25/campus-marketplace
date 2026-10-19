import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'

import grid from '@/components/infinite-grid.module.css'
import { DemoListingCard } from '@/components/listings/demo-listing-card'
import { MarketPagination } from '@/components/listings/market-pagination'
import { PublishedListingCard } from '@/components/listings/published-listing-card'
import { ListingSkeletonGrid } from '@/components/ui/workspace-skeletons'
import { getListings } from '@/lib/listings-api'
import type { Listing } from '@/types/listing'

import { demoShopProducts } from './shop-demo-data'
import styles from './shop-discovery.module.css'
import { useShopSectionScroll } from './use-shop-section-scroll'

const pageSize = 25
const eligible = (listing: Listing) =>
  listing.listingChannel === 'shop' && listing.status === 'available'
type Result = {
  status: 'error' | 'loading' | 'ready'
  listings: Listing[]
  demo: boolean
  hasNext: boolean
}

/** Shop-only public reads; demo cards never acquire persisted Listing authority. */
export function ShopProducts({
  favorites,
  allowDemo,
  onFavorite,
  overlayClassName,
  overlayStyle,
  onOverlayActiveChange,
}: {
  allowDemo: boolean
  favorites: Record<string, boolean>
  onFavorite: (id: string, value: boolean) => void
  overlayClassName?: string
  overlayStyle?: CSSProperties
  onOverlayActiveChange?: (active: boolean) => void
}) {
  const [productPage, setProductPage] = useState(1)
  const [knownPages, setKnownPages] = useState(1)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<Result>({
    status: 'loading',
    listings: [],
    demo: false,
    hasNext: false,
  })
  const loadedPage = useRef(0)
  const pendingScroll = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const scrollToProducts = useShopSectionScroll(heading)
  useLayoutEffect(() => {
    if (
      result.status === 'ready' &&
      loadedPage.current === productPage &&
      pendingScroll.current
    ) {
      pendingScroll.current = false
      scrollToProducts()
    }
  }, [productPage, result, scrollToProducts])
  useEffect(() => {
    let active = true
    setResult({ status: 'loading', listings: [], demo: false, hasNext: false })
    const load = async () => {
      try {
        const rows = await getListings({
          channel: 'shop',
          status: 'available',
          sort: 'newest',
          page: productPage,
          pageSize,
        })
        if (!active) return
        if (!rows.length && productPage > 1) {
          setProductPage(1)
          setKnownPages(1)
          return
        }
        // The existing API has no total. A one-row probe proves the next page exists,
        // without fetching every product or offering a fabricated empty page.
        const next =
          rows.length === pageSize
            ? await getListings({
                channel: 'shop',
                status: 'available',
                sort: 'newest',
                page: productPage + 1,
                pageSize: 1,
              })
            : []
        if (!active) return
        const hasNext = next.some(eligible)
        loadedPage.current = productPage
        setKnownPages(productPage + (hasNext ? 1 : 0))
        setResult({
          status: 'ready',
          listings: rows.filter(eligible),
          demo: allowDemo && productPage === 1 && rows.length === 0,
          hasNext,
        })
      } catch {
        if (active)
          setResult({
            status: 'error',
            listings: [],
            demo: false,
            hasNext: false,
          })
      }
    }
    load()
    return () => {
      active = false
    }
  }, [productPage, retry, allowDemo])
  const demoProducts = demoShopProducts
    .filter((item) => eligible(item.listing))
    .slice(0, pageSize)
  const empty = !result.demo && result.listings.length === 0
  return (
    <section
      className={styles.products}
      aria-label="Popular Shop Products"
      data-shop-products={result.status}
      data-product-page={productPage}
    >
      <h2 ref={heading} tabIndex={-1} className={styles.allTitle}>
        Popular Shop Products
      </h2>
      {result.status === 'loading' && (
        <ListingSkeletonGrid
          className={`${grid.grid} ${styles.productGrid}`}
          count={5}
        />
      )}
      {result.status === 'error' && (
        <p role="alert">
          Unable to load Shop products.{' '}
          <button type="button" onClick={() => setRetry((value) => value + 1)}>
            Retry
          </button>
        </p>
      )}
      {result.status === 'ready' && (
        <>
          {result.demo && (
            <p className={styles.previewNote}>
              Local Shop preview &middot; Demo products, not a sales ranking
            </p>
          )}
          {empty && <p role="status">No Shop products available.</p>}
          <div
            className={`${grid.grid} ${styles.productGrid}`}
            data-shop-product-grid={true}
          >
            {result.demo
              ? demoProducts.map(({ listing, categoryLabel }) => (
                  <div key={listing.id} data-shop-product={listing.id}>
                    <DemoListingCard
                      listing={listing}
                      categoryLabel={categoryLabel}
                      favorite={Boolean(favorites[listing.id])}
                      overlayClassName={overlayClassName}
                      overlayStyle={overlayStyle}
                      onFavorite={(value) => onFavorite(listing.id, value)}
                      onOverlayActiveChange={onOverlayActiveChange}
                    />
                  </div>
                ))
              : result.listings.map((listing) => (
                  <div key={listing.id} data-shop-product={listing.id}>
                    <PublishedListingCard
                      listing={listing}
                      overlayClassName={overlayClassName}
                      overlayStyle={overlayStyle}
                      onOverlayActiveChange={onOverlayActiveChange}
                    />
                  </div>
                ))}
          </div>
          {!result.demo && knownPages > 1 && (
            <MarketPagination
              label="Shop product pages"
              className={styles.sectionPagination}
              page={productPage}
              pageCount={result.hasNext ? knownPages : productPage}
              unknownTotal={result.hasNext}
              onChange={(page) => {
                pendingScroll.current = true
                setProductPage(page)
              }}
              onReturnToTop={scrollToProducts}
            />
          )}
        </>
      )}
    </section>
  )
}
