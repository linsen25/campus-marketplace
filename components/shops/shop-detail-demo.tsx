import { ArrowRight, Check, Star } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'

import FilterInteraction from '@/components/filter-interaction'
import grid from '@/components/infinite-grid.module.css'
import { DemoListingCard } from '@/components/listings/demo-listing-card'
import PulseHeart from '@/components/react-bits/pulse-heart'
import { Skeleton } from '@/components/ui/skeleton'
import { ListingSkeletonGrid } from '@/components/ui/workspace-skeletons'
import { StatefulButton } from '@/components/velora/stateful-button'

import { demoShopProducts, lunaStudioDemo as shop } from './shop-demo-data'
import styles from './shop-detail-demo.module.css'

function ShopProfile({
  loading = false,
  favorite = false,
  onFavorite,
}: {
  loading?: boolean
  favorite?: boolean
  onFavorite?: (value: boolean) => void
}) {
  return (
    <section
      className={styles.profile}
      aria-label={loading ? undefined : 'Luna Studio demo profile'}
    >
      <div className={styles.profileTop}>
        {loading ? (
          <Skeleton className={styles.image} />
        ) : (
          <>
            {/* eslint-disable-next-line @next/next/no-img-element -- Approved local demo image only. */}
            <img
              className={styles.image}
              src={shop.image}
              alt="Luna Studio demo shop"
            />
          </>
        )}
        <div className={styles.identity}>
          {loading ? (
            <>
              <Skeleton className={styles.skeletonTitle} />
              <Skeleton className={styles.skeletonLine} />
              <Skeleton className={styles.skeletonLine} />
            </>
          ) : (
            <>
              <h3>{shop.name}</h3>
              <span className={styles.verified}>
                <Check size={16} aria-hidden="true" />
                Western email verified
              </span>
              <p>{shop.tagline}</p>
            </>
          )}
        </div>
      </div>
      {!loading && (
        <div className={styles.favorite}>
          <PulseHeart
            appearance="image-overlay"
            liked={favorite}
            size={26}
            showCount={false}
            likedColor="#d97991"
            label={
              favorite
                ? 'Unfavorite demo shop: Luna Studio'
                : 'Favorite demo shop: Luna Studio'
            }
            onChange={onFavorite}
          />
        </div>
      )}
      <div className={styles.profileBody}>
        <div className={styles.stats}>
          <div className={styles.stat}>
            {loading ? (
              <>
                <Skeleton
                  className={styles.skeletonTitle}
                  style={{ width: '70%', height: 28 }}
                />
                <Skeleton
                  className={styles.skeletonLine}
                  style={{ width: '90%', height: 18 }}
                />
              </>
            ) : (
              <>
                <strong>
                  <Star size={18} aria-hidden="true" />
                  {shop.figures?.rating}
                </strong>
                <span>{shop.figures?.reviews} reviews</span>
              </>
            )}
          </div>
          <div className={styles.stat}>
            {loading ? (
              <>
                <Skeleton style={{ height: 28 }} />
                <Skeleton style={{ height: 18 }} />
              </>
            ) : (
              <>
                <strong>{shop.figures?.sold}</strong>
                <span>items sold</span>
              </>
            )}
          </div>
          <div className={styles.stat}>
            {loading ? (
              <>
                <Skeleton style={{ height: 28 }} />
                <Skeleton style={{ height: 18 }} />
              </>
            ) : (
              <>
                <strong>{shop.productCount}</strong>
                <span>products</span>
              </>
            )}
          </div>
        </div>
        <div className={styles.about}>
          {loading ? (
            <>
              <Skeleton
                className={styles.skeletonLine}
                style={{ marginBottom: 6 }}
              />
              <Skeleton className={styles.skeletonAbout} />
            </>
          ) : (
            <>
              <h4>About this shop</h4>
              <p>{shop.about}</p>
            </>
          )}
        </div>
        <div className={styles.contact}>
          {loading ? (
            <Skeleton className={styles.skeletonSearch} />
          ) : (
            <StatefulButton
              className={styles.forward}
              onClick={() => undefined}
            >
              <span className={styles.actionLabel}>
                Contact shop <ArrowRight size={18} aria-hidden="true" />
              </span>
            </StatefulButton>
          )}
        </div>
      </div>
    </section>
  )
}

export function ShopDetailSkeleton() {
  return (
    <section
      data-shop-detail-skeleton={true}
      role="status"
      aria-label="Loading demo shop"
    >
      <div aria-hidden="true">
        <Skeleton
          style={{ height: 20, width: 260, maxWidth: '100%', marginBottom: 12 }}
        />
        <ShopProfile loading={true} />
        <div className={styles.toolbar}>
          <Skeleton className={styles.skeletonTabs} />
          <div className={styles.tools}>
            <Skeleton className={styles.skeletonSearch} />
            <Skeleton className={styles.skeletonSort} />
          </div>
        </div>
        <ListingSkeletonGrid className={grid.grid} count={shop.productCount} />
      </div>
    </section>
  )
}
const tabs = ['Products', 'Reviews', 'About'] as const
type Tab = typeof tabs[number]
const sortOptions = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-low', label: 'Price: Low to High' },
  { value: 'price-high', label: 'Price: High to Low' },
]
export function ShopDetailDemo({
  favorite,
  onFavorite,
  favorites,
  onProductFavorite,
  onOverlayActiveChange,
  overlayClassName,
  overlayStyle,
}: {
  favorite: boolean
  onFavorite: (value: boolean) => void
  favorites: Record<string, boolean>
  onProductFavorite: (id: string, value: boolean) => void
  onOverlayActiveChange?: (value: boolean) => void
  overlayClassName?: string
  overlayStyle?: CSSProperties
}) {
  const id = useId()
  const [tab, setTab] = useState<Tab>('Products')
  const [search, setSearch] = useState('')
  const [sort, setSort] = useState('newest')
  const [sortOpen, setSortOpen] = useState(false)
  const tabRefs = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({})
  const navigateTab = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number
  ) => {
    let next = index
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length
    else if (event.key === 'ArrowLeft')
      next = (index + tabs.length - 1) % tabs.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = tabs.length - 1
    else return
    event.preventDefault()
    setTab(tabs[next])
    tabRefs.current[tabs[next]]?.focus({ preventScroll: true })
  }
  const query = search.trim().toLowerCase()
  const products = demoShopProducts
    .filter((item) =>
      `${item.listing.title} ${item.categoryLabel}`
        .toLowerCase()
        .includes(query)
    )
    .slice()
    .sort((a, b) => {
      if (sort === 'price-low') return a.listing.price - b.listing.price
      if (sort === 'price-high') return b.listing.price - a.listing.price
      return b.listing.createdAt.localeCompare(a.listing.createdAt)
    })
  return (
    <div data-shop-detail-demo={true} className={styles.detail}>
      <p className={styles.demoNote}>
        Local Shop demo &middot; Illustrative products, images and figures
      </p>
      <ShopProfile favorite={favorite} onFavorite={onFavorite} />
      <div className={styles.toolbar}>
        <div
          role="tablist"
          aria-label="Demo shop sections"
          className={styles.tabs}
        >
          {tabs.map((name, index) => (
            <button
              key={name}
              ref={(node) => {
                tabRefs.current[name] = node
              }}
              type="button"
              role="tab"
              id={`${id}-${name}`}
              aria-selected={tab === name}
              aria-controls={`${id}-panel`}
              tabIndex={tab === name ? 0 : -1}
              onKeyDown={(event) => navigateTab(event, index)}
              onClick={() => setTab(name)}
            >
              {name}
              {name === 'Products' && ` (${shop.productCount})`}
              {name === 'Reviews' && ` (${shop.figures?.reviews})`}
            </button>
          ))}
        </div>
        {tab === 'Products' && (
          <div className={styles.tools}>
            <input
              className={styles.search}
              type="search"
              aria-label="Search products in this shop"
              placeholder="Search products in this shop..."
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            <FilterInteraction
              label="Sort"
              mobileLabel="Sort"
              options={sortOptions}
              value={sort}
              isOpen={sortOpen}
              onOpenChange={setSortOpen}
              onChange={setSort}
            />
          </div>
        )}
      </div>
      <section
        role="tabpanel"
        id={`${id}-panel`}
        aria-labelledby={`${id}-${tab}`}
      >
        {tab === 'Products' && (
          <>
            {products.length ? (
              <div data-demo-shop-products={true} className={grid.grid}>
                {products.map(({ listing, categoryLabel }) => (
                  <DemoListingCard
                    key={listing.id}
                    listing={listing}
                    categoryLabel={categoryLabel}
                    favorite={Boolean(favorites[listing.id])}
                    overlayClassName={overlayClassName}
                    overlayStyle={overlayStyle}
                    onFavorite={(value) => onProductFavorite(listing.id, value)}
                    onOverlayActiveChange={onOverlayActiveChange}
                  />
                ))}
              </div>
            ) : (
              <p className={styles.neutral}>
                No demo products match your search.
              </p>
            )}
          </>
        )}
        {tab === 'Reviews' && (
          <p className={styles.neutral}>
            Reviews will appear here when Shop Reviews are connected.
          </p>
        )}
        {tab === 'About' && (
          <section className={styles.neutral}>
            <h3>{shop.name}</h3>
            <p>{shop.tagline}</p>
            <p>{shop.about}</p>
          </section>
        )}
      </section>
    </div>
  )
}
