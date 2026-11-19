import { usePageSlide } from '@/components/navigation/desktop-route-transition'
import { useCallback, useEffect, useRef, useState } from 'react'
import ShiningButton from '@/components/animata/button/shining-button'
import FilterInteraction from '@/components/filter-interaction'
import { MarketPagination } from '@/components/listings/market-pagination'
import workspace from '@/components/listings/listing-workspace.module.css'
import favoritesGrid from '@/components/listings/favorites.module.css'
import { PublishedListingCard } from '@/components/listings/published-listing-card'
import {
  ContentStateRegion,
  WorkspaceEmpty,
} from '@/components/listings/workspace-empty'
import { getFavoriteShopProducts } from '@/lib/favorites-api'
import type { FavoriteShopProduct, ShopListingIdentity } from '@/types/shop'

import styles from './shop-favorite-products.module.css'
import { demoShopIdentity, demoShopProducts } from './shop-demo-data'

const allShops = ''

export function ShopFavoriteProducts({
  demo = false,
  search = '',
  category = '',
  filter = 'all',
  sort = 'newest',
}: {
  demo?: boolean
  search?: string
  category?: string
  filter?: string
  sort?: string
}) {
  const navigate = usePageSlide()
  const [items, setItems] = useState<FavoriteShopProduct[]>([])
  const [shops, setShops] = useState<ShopListingIdentity[]>([])
  const [shopId, setShopId] = useState(allShops)
  const workspaceRef = useRef<HTMLElement>(null)
  const [filterPortalContainer, setFilterPortalContainer] =
    useState<HTMLElement | null>(null)
  const [shopFilterOpen, setShopFilterOpen] = useState(false)
  const [shopFilterClosing, setShopFilterClosing] = useState(false)
  const shopFilterTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [page, setPage] = useState(1)
  const [hasNextPage, setHasNextPage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const version = useRef(0)

  const invalidate = useCallback(() => {
    ++version.current
  }, [])

  const load = useCallback(async () => {
    const request = ++version.current
    setError('')
    try {
      const result = await getFavoriteShopProducts({
        page,
        pageSize: 20,
        ...(shopId ? { shopId } : {}),
        ...(search.trim() ? { search: search.trim() } : {}),
        ...(category ? { category } : {}),
        ...(sort !== 'newest' ? { sort } : {}),
      })
      if (request !== version.current) return
      setItems(result.items)
      setShops(result.shops)
      setHasNextPage(result.hasNextPage)
    } catch (reason) {
      if (request === version.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to load favorite products.'
        )
    } finally {
      if (request === version.current) setLoading(false)
    }
  }, [page, shopId, search, category, sort])

  useEffect(() => {
    if (demo) {
      const shop = {
        id: demoShopIdentity.id,
        shopName: demoShopIdentity.shopName,
        username: demoShopIdentity.username,
      }
      setItems(
        demoShopProducts.slice(0, 4).map(({ listing }) => ({ listing, shop }))
      )
      setShops([shop])
      setHasNextPage(false)
      setLoading(false)
      setError('')
      return undefined
    }
    setLoading(true)
    setItems([])
    load()
    return invalidate
  }, [demo, load, invalidate])

  useEffect(() => {
    setFilterPortalContainer(
      workspaceRef.current?.closest<HTMLElement>('[data-home-main]') ?? null
    )
  }, [])

  useEffect(() => {
    setPage(1)
  }, [search, category, sort])

  function chooseShop(nextShopId: string) {
    setShopId(nextShopId)
    setPage(1)
  }

  const toggleShopFilter = useCallback((open: boolean) => {
    if (shopFilterTimer.current) {
      clearTimeout(shopFilterTimer.current)
      shopFilterTimer.current = null
    }

    if (open) {
      setShopFilterClosing(false)
      setShopFilterOpen(true)
    } else {
      setShopFilterClosing(true)

      shopFilterTimer.current = setTimeout(() => {
        setShopFilterOpen(false)
        setShopFilterClosing(false)
        shopFilterTimer.current = null
      }, 180)
    }
  }, [])

  useEffect(() => {
    return () => {
      if (shopFilterTimer.current) {
        clearTimeout(shopFilterTimer.current)
      }
    }
  }, [])

  const visibleItems = demo
    ? items
        .filter(
          ({ listing }) =>
            listing.title
              .toLocaleLowerCase()
              .includes(search.trim().toLocaleLowerCase()) &&
            (!category || listing.category === category) &&
            (filter === 'all' ||
              (filter === 'under25'
                ? listing.price < 2500
                : listing.price >= 2500))
        )
        .sort((a, b) => {
          if (sort === 'name')
            return a.listing.title.localeCompare(b.listing.title)
          if (sort === 'price-asc') return a.listing.price - b.listing.price
          if (sort === 'price-desc') return b.listing.price - a.listing.price
          return b.listing.createdAt.localeCompare(a.listing.createdAt)
        })
    : items

  return (
    <section
      ref={workspaceRef}
      className={styles.workspace}
      aria-label="Favorite Shop products"
    >
      {!demo && (
        <div className={styles.filter}>
          <span>Shop</span>
          <FilterInteraction
            label="Shop"
            appearance="select"
            value={shopId}
            portalContainer={filterPortalContainer}
            options={[
              { value: allShops, label: 'All Shops' },
              ...shops.map((shop) => ({
                value: shop.id,
                label: shop.shopName,
              })),
            ]}
            disabled={loading && !shops.length}
            isOpen={shopFilterOpen}
            isClosing={shopFilterClosing}
            onOpenChange={toggleShopFilter}
            onChange={chooseShop}
            triggerClassName={styles.shopSelect}
            panelClassName={styles.shopPanel}
          />
        </div>
      )}
      {!loading && error && (
        <ContentStateRegion>
          <div className={styles.errorState} role="alert">
            <p>Couldn&apos;t load favorite products.</p>
            <ShiningButton
              variant="purple"
              showArrow={false}
              desktopAppearance={true}
              onClick={() => {
                setLoading(true)
                void load()
              }}
            >
              Retry
            </ShiningButton>
          </div>
        </ContentStateRegion>
      )}
      {!loading && !error && !visibleItems.length && (
        <WorkspaceEmpty>
          {shopId
            ? 'No saved products from this Shop.'
            : 'No favorite Shop products yet.'}
        </WorkspaceEmpty>
      )}
      {!loading && !error && visibleItems.length > 0 && (
        <div
          className={`${workspace.grid} ${favoritesGrid.grid} ${styles.productGrid}`}
        >
          {visibleItems.map(({ listing, shop }) => (
            <article key={listing.id}>
              <PublishedListingCard
                listing={listing}
                onGoToShop={() =>
                  navigate(
                    demo
                      ? `/listings?shop=demo-luna&product=${encodeURIComponent(
                          listing.id
                        )}`
                      : `/shop/${encodeURIComponent(
                          shop.username
                        )}?listing=${encodeURIComponent(listing.id)}`
                  )
                }
                initiallyFavorited={true}
                favoriteDisabled={demo}
                /* Keep this view's loaded snapshot stable after an unfavorite.
                   A tab switch, refresh, or new query reads the real state again. */
                onUnfavorite={() => undefined}
              />
            </article>
          ))}
        </div>
      )}
      <MarketPagination
        page={page}
        pageCount={page + (hasNextPage ? 1 : 0)}
        unknownTotal={hasNextPage}
        label="Favorite product pages"
        className={styles.pagination}
        onChange={setPage}
        onReturnToTop={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />
    </section>
  )
}
