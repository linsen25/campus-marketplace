import { AnimatePresence } from 'framer-motion'
import { Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import {
  ProductCostDialog,
  ShopExpenses,
} from '@/components/shops/shop-costs-manager'
import { ShopFavorites } from '@/components/shops/shop-favorites'
import { useContentReveal } from '@/components/ui/content-reveal'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import { ListingSkeletonGrid } from '@/components/ui/workspace-skeletons'
import {
  deleteListing,
  getMyListings,
  markListingSold,
} from '@/lib/listings-api'
import type { Listing } from '@/types/listing'

import { ContentStateError } from './content-state-error'
import { Favorites } from './favorites'
import listingColumns from './favorites.module.css'
import { ListingConfirmation } from './listing-confirmation'
import { ListingCreationSheet } from './listing-creation-sheet'
import type { ListingLeaveGuard } from './listing-form'
import { ListingSortFilter } from './listing-sort-filter'
import styles from './listing-workspace.module.css'
import type { MarketFilterValues } from './market-filter'
import { useMarketplaceSession } from './marketplace-session'
import { ResaleManagementCard } from './resale-management-card'
import resaleStyles from './resale-management.module.css'
import shopStyles from './shop-management.module.css'
import { WorkspaceEmpty } from './workspace-empty'

const auxiliaryPages = new Map([
  ['favorites', <Favorites key="favorites" channel="resale" />],
  ['shop-favorites', <ShopFavorites key="shop-favorites" />],
])

const scopes = {
  resale: {
    channel: 'resale',
    destination: 'my-listings',
    label: 'Manage Resale',
    createLabel: 'Create Resale',
  },
  shop: {
    channel: 'shop',
    destination: 'my-shop',
    label: 'Manage Products',
    createLabel: 'Add Product',
  },
} as const

function listingScope(page: string) {
  return scopes[
    ['my-shop', 'create-shop-listing', 'shop-favorites'].includes(page)
      ? 'shop'
      : 'resale'
  ]
}

function managementEmptyMessage(
  channel: string,
  tab: number,
  applied: MarketFilterValues,
  search: string
) {
  if (channel === 'shop' && search.trim())
    return 'No products match your search.'
  if (Object.values(applied).some(Boolean))
    return 'No listings match your filters.'
  if (channel === 'shop')
    return tab === 0 ? 'No active products yet.' : 'No sold products yet.'
  return tab === 0 ? 'No active listings yet.' : 'No sold listings yet.'
}

/** Explicit isolated demo injection only; real empty inventory stays empty. */
function shouldShowShopDemo(
  channel: string,
  loading: boolean,
  error: string,
  items: Listing[],
  demoProducts?: Listing[]
) {
  return Boolean(
    demoProducts?.length &&
      channel === 'shop' &&
      !loading &&
      !error &&
      items.length === 0
  )
}

function ProductSearch({
  value,
  onChange,
  desktop = false,
}: {
  value: string
  onChange: (value: string) => void
  desktop?: boolean
}) {
  return (
    <label
      className={`${styles.field} ${shopStyles.search} ${
        desktop ? shopStyles.desktopSearch : shopStyles.mobileSearch
      }`}
    >
      <Search size={17} aria-hidden="true" />
      <input
        type="search"
        aria-label="Search your products"
        placeholder="Search your products..."
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

function ManagementTools({
  channel,
  applied,
  sort,
  onSort,
  onFilter,
  onCreate,
  search,
  onSearch,
}: {
  search: string
  onSearch: (value: string) => void
  channel: string
  applied: MarketFilterValues
  sort: string
  onSort: (sort: string) => void
  onFilter: (values: MarketFilterValues) => void
  onCreate: () => void
}) {
  return (
    <div
      className={resaleStyles.managementControls}
      data-resale-toolbar={channel === 'resale' || undefined}
      data-shop-toolbar={channel === 'shop' || undefined}
    >
      {channel === 'shop' && (
        <ProductSearch value={search} desktop={true} onChange={onSearch} />
      )}
      <button
        type="button"
        className={resaleStyles.createButton}
        onClick={onCreate}
      >
        <Plus size={16} aria-hidden={true} />
        <span className={resaleStyles.fullCreateLabel}>
          {channel === 'shop' ? 'Add Product' : 'Create Resale'}
        </span>
        <span className={resaleStyles.compactCreateLabel}>
          {channel === 'shop' ? 'Add' : 'Create'}
        </span>
      </button>
      <ListingSortFilter
        applied={applied}
        sort={sort}
        showSort={false}
        overlaySelects={true}
        panelClassName={resaleStyles.filterPanel}
        triggerClassName={resaleStyles.darkControl}
        onSort={onSort}
        onFilter={onFilter}
      />
    </div>
  )
}
function managementGrid() {
  return `${styles.grid} ${listingColumns.grid} ${resaleStyles.grid}`
}
function ManagementStatus({
  tab,
  onTab,
  children,
}: {
  tab: number
  onTab: (tab: number) => void
  children: ReactNode
}) {
  return (
    <div className={`${styles.toolbar} ${resaleStyles.statusToolbar}`}>
      <FluidTabs activeIndex={tab} onActiveIndexChange={onTab}>
        <FluidTabs.List aria-label="Listing status">
          <FluidTabs.Tab>
            <FluidTabs.Label>Active</FluidTabs.Label>
          </FluidTabs.Tab>
          <FluidTabs.Tab>
            <FluidTabs.Label>Sold</FluidTabs.Label>
          </FluidTabs.Tab>
        </FluidTabs.List>
      </FluidTabs>
      {children}
    </div>
  )
}

function ManagementEditSheet({
  channel,
  listing,
  onClose,
  onSaved,
  onGuardChange,
}: {
  channel: 'resale' | 'shop'
  listing: Listing | null
  onClose: () => void
  onSaved: (listing: Listing) => void
  onGuardChange: (guard: ListingLeaveGuard | null) => void
}) {
  return (
    <AnimatePresence>
      {listing && listing.listingChannel === channel && (
        <ListingCreationSheet
          mode={channel}
          listing={listing}
          onClose={onClose}
          onSaved={onSaved}
          onGuardChange={onGuardChange}
        />
      )}
    </AnimatePresence>
  )
}
function OwnerExpenses({ channel, demo }: { channel: string; demo: boolean }) {
  return channel === 'shop' && !demo ? <ShopExpenses /> : null
}

function productCostAction(
  channel: string,
  demo: boolean,
  listing: Listing,
  select: (listing: Listing) => void
) {
  return channel === 'shop' && !demo ? () => select(listing) : undefined
}

function OwnerProductCost({
  listing,
  onClose,
}: {
  listing: Listing | null
  onClose: () => void
}) {
  return (
    <AnimatePresence>
      {listing && (
        <ProductCostDialog
          key={listing.id}
          listing={listing}
          onClose={onClose}
        />
      )}
    </AnimatePresence>
  )
}

function OwnerListings({
  page,
  onSelect,
  onGuardChange,
  demoProducts,
}: {
  page: string
  demoProducts?: Listing[]
  onSelect: (page: string) => void
  onGuardChange: (guard: ListingLeaveGuard | null) => void
}) {
  const [items, setItems] = useState<Listing[]>([])
  const [tab, setTab] = useState(0)
  const [sort, setSort] = useState('newest')
  const [applied, setApplied] = useState<MarketFilterValues>({
    category: '',
    subcategory: '',
    place: '',
    condition: '',
  })
  const [edit, setEdit] = useState<Listing | null>(null)
  const [costProduct, setCostProduct] = useState<Listing | null>(null)
  const [confirmation, setConfirmation] = useState<{
    listing: Listing
    action: 'delete' | 'sold'
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const reveal = useContentReveal(loading)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const pending = useRef(false)
  const version = useRef(0)
  const scope = listingScope(page)
  const { channel, destination: managementDestination } = scope
  const editing = Boolean(edit)
  const [search, setSearch] = useState('')
  const creationPage = ['create-listing', 'create-shop-listing'].includes(page)
  const managementPage = [
    'my-listings',
    'my-shop',
    'create-listing',
    'create-shop-listing',
  ].includes(page)
  const [creationOpen, setCreationOpen] = useState(creationPage)
  useEffect(() => {
    setCreationOpen(creationPage)
  }, [creationPage, page])
  const closeCreation = () => {
    setCreationOpen(false)
    if (creationPage) onSelect(managementDestination)
  }
  const load = useCallback(async () => {
    const request = ++version.current
    try {
      const result = await getMyListings({ channel })
      if (request === version.current) {
        setItems(
          result.filter(
            (item) => item.publishedAt && item.listingChannel === channel
          )
        )
        setError('')
      }
    } catch (reason) {
      if (request === version.current)
        setError(
          reason instanceof Error
            ? reason.message
            : 'Unable to load your listings.'
        )
    } finally {
      if (request === version.current) setLoading(false)
    }
  }, [channel])
  useEffect(() => {
    if (!managementPage) return undefined
    setLoading(true)
    load()
    const refresh = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('marketplace-listings-changed', refresh)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This is a request sequence, not a DOM ref.
      ++version.current
      window.removeEventListener('focus', refresh)
      window.removeEventListener('marketplace-listings-changed', refresh)
    }
  }, [load, managementPage])
  useEffect(() => {
    setEdit(null)
    setConfirmation(null)
  }, [page])
  async function manage() {
    if (!confirmation || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const { listing, action } = confirmation
      if (action === 'delete') {
        await deleteListing(listing.id)
        setItems((current) => current.filter((item) => item.id !== listing.id))
        setNotice('Listing deleted')
      } else {
        const sold = await markListingSold(listing.id)
        setItems((current) =>
          current.map((item) => (item.id === sold.id ? sold : item))
        )
        setNotice('Listing marked as sold')
      }
      setConfirmation(null)
      window.dispatchEvent(new Event('marketplace-listings-changed'))
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : 'Unable to update listing.'
      )
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const saved = (listing: Listing) => {
    if (listing.listingChannel !== channel) return
    ++version.current
    setItems((current) =>
      editing
        ? current.map((item) => (item.id === listing.id ? listing : item))
        : [listing, ...current.filter((item) => item.id !== listing.id)]
    )
    setNotice(edit ? 'Changes saved' : 'Listing created')
    setCreationOpen(false)
    setEdit(null)
    if (editing) return
    setTab(0)
    onSelect(managementDestination)
  }
  const auxiliary = auxiliaryPages.get(page)
  if (auxiliary) return auxiliary
  const showShopDemo = shouldShowShopDemo(
    channel,
    loading,
    error,
    items,
    demoProducts
  )
  const managementItems = showShopDemo ? demoProducts || [] : items
  const visible = managementItems
    .filter(
      (item) =>
        item.listingChannel === channel &&
        (channel !== 'shop' ||
          item.title
            .toLocaleLowerCase()
            .includes(search.trim().toLocaleLowerCase())) &&
        (tab === 0
          ? item.status === 'available' ||
            item.status === 'reserved' ||
            item.status === 'pending'
          : item.status === 'sold') &&
        (!applied.category || item.category === applied.category) &&
        (!applied.subcategory || item.subcategory === applied.subcategory) &&
        (!applied.place || item.pickupArea === applied.place) &&
        (!applied.condition || item.condition === applied.condition)
    )
    .sort((a, b) => {
      if (sort === 'price-asc') return a.price - b.price
      if (sort === 'price-desc') return b.price - a.price
      return b.createdAt.localeCompare(a.createdAt)
    })
  const gridClass = managementGrid()
  return (
    <section
      className={`${styles.workspace} ${
        channel === 'shop' ? shopStyles.workspace : ''
      }`}
      aria-label={scope.label}
      data-management-channel={channel}
    >
      <ManagementStatus tab={tab} onTab={setTab}>
        <ManagementTools
          channel={channel}
          applied={applied}
          sort={sort}
          search={search}
          onSort={setSort}
          onFilter={setApplied}
          onCreate={() => setCreationOpen(true)}
          onSearch={setSearch}
        />
      </ManagementStatus>
      {channel === 'shop' && (
        <ProductSearch value={search} onChange={setSearch} />
      )}
      <LocalTabContent tab={tab}>
        <OwnerExpenses channel={channel} demo={showShopDemo} />
        {showShopDemo && (
          <p className={shopStyles.demoNotice} data-shop-management-demo={true}>
            Demo products - Preview only. These are sample products, not your
            inventory.
          </p>
        )}
        {notice && <p role="status">{notice}</p>}
        {loading && <ListingSkeletonGrid className={gridClass} />}
        {!loading && error && !confirmation && (
          <ContentStateError
            className={reveal}
            onRetry={() => {
              setLoading(!items.length)
              load()
            }}
          >
            {error}
          </ContentStateError>
        )}
        {!loading && !error && !visible.length && (
          <WorkspaceEmpty className={reveal}>
            {managementEmptyMessage(channel, tab, applied, search)}
          </WorkspaceEmpty>
        )}
        <div className={`${gridClass} ${reveal}`} hidden={!visible.length}>
          {visible.map((listing) => (
            <ResaleManagementCard
              key={listing.id}
              listing={listing}
              channel={channel}
              demo={showShopDemo}
              onCost={productCostAction(
                channel,
                showShopDemo,
                listing,
                setCostProduct
              )}
              onEdit={() => {
                if (!showShopDemo) setEdit(listing)
              }}
              onDelete={() => {
                if (showShopDemo) return
                setError('')
                setConfirmation({ listing, action: 'delete' })
              }}
              onMarkSold={
                channel === 'shop' && !showShopDemo
                  ? () => {
                      setError('')
                      setConfirmation({ listing, action: 'sold' })
                    }
                  : undefined
              }
            />
          ))}
        </div>
      </LocalTabContent>
      <ManagementEditSheet
        channel={channel}
        listing={edit}
        onClose={() => setEdit(null)}
        onSaved={saved}
        onGuardChange={onGuardChange}
      />
      <OwnerProductCost
        listing={costProduct}
        onClose={() => setCostProduct(null)}
      />
      <AnimatePresence>
        {creationOpen && (
          <ListingCreationSheet
            mode={channel}
            onClose={closeCreation}
            onSaved={saved}
            onGuardChange={onGuardChange}
          />
        )}
      </AnimatePresence>
      <AnimatePresence>
        {confirmation && (
          <ListingConfirmation
            title={
              confirmation.action === 'sold'
                ? 'Mark this listing as sold?'
                : 'Delete this listing?'
            }
            confirm={confirmation.action === 'sold' ? 'Mark as sold' : 'Delete'}
            busy={busy}
            error={error}
            onCancel={() => {
              setConfirmation(null)
              setError('')
            }}
            onConfirm={() => manage()}
          >
            {confirmation.action === 'sold'
              ? 'It will be removed from Marketplace and can no longer be edited.'
              : 'This permanently deletes the listing. It will not appear in Sold history.'}
          </ListingConfirmation>
        )}
      </AnimatePresence>
    </section>
  )
}

/** Reset private inventory/dialogs when the authenticated owner changes. */
export function HomeListings(props: Parameters<typeof OwnerListings>[0]) {
  const { seller } = useMarketplaceSession()
  return <OwnerListings key={seller?.id || 'anonymous'} {...props} />
}
