import card from '@/components/listings/welcome-demo-cards.module.css'
import { useEffect, useState } from 'react'
import {
  ArrowDownWideNarrow,
  ChevronDown,
  ListFilter,
  Search,
} from 'lucide-react'
import FilterInteraction from '@/components/filter-interaction'
import { listingCategories } from '@/lib/listing-metadata'
import { SHOP_CATEGORIES, shopDirectoryCategory } from '@/lib/shop-directory'
import { demoShopProducts } from './shop-demo-data'

import { useAuthModal } from '@/components/auth/auth-modal'
import {
  usePageSlide,
  usePendingDestination,
} from '@/components/navigation/desktop-route-transition'
import { ContentStateError } from '@/components/listings/content-state-error'
import { MarketPagination } from '@/components/listings/market-pagination'
import workspace from '@/components/listings/listing-workspace.module.css'
import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { WorkspaceEmpty } from '@/components/listings/workspace-empty'
import { usePublicShopRead } from '@/hooks/use-public-shop-read'
import { useShopFavoritesAccount } from '@/hooks/use-shop-favorites'
import { readFavoriteShops } from '@/lib/shop-favorites-api'

import { ShopCard } from './shop-card'
import { ShopCardPresentation } from './shop-card-presentation'
import ShiningButton from '@/components/animata/button/shining-button'
import grid from './shop-detail-demo.module.css'
import { ShopFavoriteProducts } from './shop-favorite-products'
import { lunaStudioDemo } from './shop-demo-data'
import styles from './shop-favorites.module.css'

function DemoSavedShops({
  search,
  category,
}: {
  search: string
  category: string
}) {
  const [favorited, setFavorited] = useState(true)
  const navigate = usePageSlide()
  const navigating = usePendingDestination() === '/listings?shop=demo-luna'
  const matches =
    lunaStudioDemo.name
      .toLocaleLowerCase()
      .includes(search.trim().toLocaleLowerCase()) &&
    (!category || shopDirectoryCategory(lunaStudioDemo.category) === category)

  return (
    <section className={workspace.workspace} aria-label="Favorite Shops">
      {!matches && (
        <WorkspaceEmpty>No saved shops match your search.</WorkspaceEmpty>
      )}
      <div
        className={grid.allShopsGrid}
        data-all-shops-grid={true}
        hidden={!matches}
        style={{ display: matches ? undefined : 'none' }}
      >
        <div className={grid.demoEntry} data-directory-shop="demo-luna">
          <ShopCardPresentation
            demo={true}
            shop={{
              name: lunaStudioDemo.name,
              tagline: lunaStudioDemo.tagline,
              image: lunaStudioDemo.image,
            }}
            favorite={favorited}
            onFavorite={setFavorited}
            action={
              <div className={card.shopActionWrapper}>
                <ShiningButton
                  variant="green"
                  size="compact"
                  loading={navigating}
                  disabled={navigating}
                  onClick={() => navigate('/listings?shop=demo-luna')}
                >
                  {navigating ? 'Opening shop...' : 'Go to shop'}
                </ShiningButton>
              </div>
            }
          />
        </div>
      </div>
      <MarketPagination
        className={styles.pagination}
        page={1}
        pageCount={1}
        label="Favorite Shop pages"
        onChange={() => undefined}
        onReturnToTop={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />
    </section>
  )
}

function SavedShops({
  search,
  category,
  sort,
}: {
  search: string
  category: string
  sort: string
}) {
  /* Legacy demo rendering is handled by DemoSavedShops so this reader never
     initializes a real favorites request in demo mode.
    return (
      <section className={workspace.workspace} aria-label="Favorite Shops">
        <article className={styles.demoShop}>
          <img src={lunaStudioDemo.image} alt="" />
          <div>
            <strong>{lunaStudioDemo.name}</strong>
            <p>{lunaStudioDemo.tagline}</p>
            <small>Demo Data · Preview only</small>
          </div>
        </article>
      </section>
    )
  */
  const { actor, listRevision } = useShopFavoritesAccount()
  const [page, setPage] = useState(1)
  const result = usePublicShopRead(
    `${actor}:${page}:${listRevision}:${search}:${category}:${sort}`,
    () => readFavoriteShops({ page, search, category, sort })
  )
  useEffect(() => {
    if (page > 1 && result.data?.shops.length === 0) setPage(1)
  }, [page, result.data])
  return (
    <section className={workspace.workspace} aria-label="Favorite Shops">
      {result.loading && <p role="status">Loading favorite shops...</p>}
      {result.error && (
        <ContentStateError onRetry={() => result.retry()}>
          Couldn&apos;t load favorite shops.
        </ContentStateError>
      )}
      {!result.loading && !result.error && !result.data?.shops.length && (
        <WorkspaceEmpty>No available favorite shops.</WorkspaceEmpty>
      )}
      <div className={grid.allShopsGrid}>
        {result.data?.shops.map((shop) => (
          <ShopCard key={shop.id} shop={shop} />
        ))}
      </div>
      <MarketPagination
        className={styles.pagination}
        page={page}
        pageCount={page + (result.data?.hasNextPage ? 1 : 0)}
        unknownTotal={Boolean(result.data?.hasNextPage)}
        label="Favorite Shop pages"
        onChange={setPage}
        onReturnToTop={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
      />
    </section>
  )
}

export function ShopFavorites({ demo = false }: { demo?: boolean }) {
  const [tab, setTab] = useState<'shops' | 'products'>('shops')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250)
    return () => window.clearTimeout(timer)
  }, [search])
  const [category, setCategory] = useState('')
  const [sort, setSort] = useState('newest')
  const [menu, setMenu] = useState<'category' | 'sort' | null>(null)
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const suggestions = demo
    ? (tab === 'shops'
        ? [lunaStudioDemo.name]
        : demoShopProducts.slice(0, 4).map(({ listing }) => listing.title)
      ).filter((title) =>
        title.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())
      )
    : []
  const { seller, loading } = useMarketplaceSession()
  const { openAuth } = useAuthModal()
  let content = demo ? (
    <DemoSavedShops search={search} category={category} />
  ) : (
    <SavedShops
      key={`${seller?.id}:${debouncedSearch}:${category}:${sort}`}
      search={debouncedSearch}
      category={category}
      sort={sort}
    />
  )
  if (tab === 'products')
    content = (
      <ShopFavoriteProducts
        key={seller?.id}
        demo={demo}
        search={demo ? search : debouncedSearch}
        category={category}
        sort={sort}
      />
    )
  else if (!demo && loading)
    content = <p role="status">Loading favorite shops...</p>
  else if (!demo && !seller)
    content = (
      <WorkspaceEmpty>
        Log in to view your favorite shops.{' '}
        <button
          type="button"
          onClick={() => openAuth({ mode: 'signin', intent: 'login' })}
        >
          Log in
        </button>
      </WorkspaceEmpty>
    )
  return (
    <section aria-label="Shop Favorites" className={workspace.workspace}>
      <div className={styles.favoritesToolbar}>
        <SegmentedControl
          className={styles.tabs}
          ariaLabel="Shop Favorites type"
          value={tab}
          onChange={(next) => {
            setTab(next)
            setSearch('')
            setCategory('')
            setSort('newest')
            setMenu(null)
            setSuggestionsOpen(false)
          }}
          items={[
            { value: 'shops', label: 'Shops' },
            { value: 'products', label: 'Products' },
          ]}
        />
        <div className={styles.searchWrap}>
          <label
            className={styles.favoritesSearch}
            data-favorites-search={true}
          >
            <Search size={18} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onFocus={() => setSuggestionsOpen(true)}
              onBlur={() =>
                window.setTimeout(() => setSuggestionsOpen(false), 120)
              }
              onChange={(event) => {
                setSearch(event.target.value)
                setSuggestionsOpen(true)
              }}
              placeholder={
                tab === 'shops'
                  ? 'Search favorite shops...'
                  : 'Search favorite products...'
              }
              aria-label={
                tab === 'shops'
                  ? 'Search saved shop names'
                  : 'Search saved product titles'
              }
            />
          </label>
          {demo && suggestionsOpen && search.trim() && suggestions.length > 0 && (
            <div
              className={styles.suggestions}
              role="listbox"
              aria-label="Saved favorites matching names"
            >
              {Array.from(new Set(suggestions))
                .slice(0, 5)
                .map((title) => (
                  <button
                    key={title}
                    type="button"
                    role="option"
                    aria-selected={false}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSearch(title)
                      setSuggestionsOpen(false)
                    }}
                  >
                    {title}
                  </button>
                ))}
            </div>
          )}
        </div>
        <div className={styles.controlRow}>
          {(tab === 'products' || tab === 'shops') && (
            <FilterInteraction
              label="Category"
              mobileLabel=""
              options={
                tab === 'shops'
                  ? [
                      { value: '', label: 'All Categories' },
                      ...SHOP_CATEGORIES.map((value) => ({
                        value,
                        label: value,
                      })),
                    ]
                  : [
                      { value: '', label: 'All Categories' },
                      ...listingCategories,
                    ]
              }
              value={category}
              isOpen={menu === 'category'}
              onOpenChange={(open) => setMenu(open ? 'category' : null)}
              onChange={setCategory}
              triggerClassName={styles.favoriteDropdown}
              hasChevron={true}
              triggerContent={
                <>
                  <ListFilter size={18} aria-hidden="true" />
                  <span>Category</span>
                  <ChevronDown size={14} aria-hidden="true" />
                </>
              }
            />
          )}
          <FilterInteraction
            label="Sort"
            options={[
              { value: 'newest', label: 'Newest' },
              { value: 'name', label: 'Name A-Z' },
              ...(tab === 'products'
                ? [
                    { value: 'price-asc', label: 'Price: Low to High' },
                    { value: 'price-desc', label: 'Price: High to Low' },
                  ]
                : []),
            ]}
            value={sort}
            isOpen={menu === 'sort'}
            onOpenChange={(open) => setMenu(open ? 'sort' : null)}
            onChange={setSort}
            triggerClassName={styles.favoriteDropdown}
            hasChevron={true}
            triggerContent={
              <>
                <ArrowDownWideNarrow size={18} aria-hidden="true" />
                <span>
                  {sort === 'newest'
                    ? 'Newest'
                    : sort === 'name'
                    ? 'Name A-Z'
                    : sort === 'price-asc'
                    ? 'Price: Low to High'
                    : 'Price: High to Low'}
                </span>
                <ChevronDown size={14} aria-hidden="true" />
              </>
            }
          />
        </div>
      </div>
      {content}
    </section>
  )
}
