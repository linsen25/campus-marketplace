import { AnimatePresence } from 'framer-motion'
import {
  Check,
  ChevronDown,
  CircleCheck,
  ListFilter,
  Package,
  Plus,
  Search,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import FilterInteraction from '@/components/filter-interaction'
import { SegmentedControl } from '@/components/ui/segmented-control'
import { ProductCostDialog } from '@/components/shops/shop-costs-manager'
import { ProductInventoryDialog } from '@/components/shops/shop-inventory-dialog'
import { ShopFavorites } from '@/components/shops/shop-favorites'
import { ShopProductTable } from '@/components/shops/shop-product-table'
import favoriteStyles from '@/components/shops/shop-favorites.module.css'
import { ListingMedia } from '@/components/listings/listing-media'
import { ExpandableCard } from '@/components/velora/expandable-card'
import { useContentReveal } from '@/components/ui/content-reveal'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import { ListingSkeletonGrid } from '@/components/ui/workspace-skeletons'
import { listingCategories } from '@/lib/listing-metadata'
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
import { PublishedListingDetails } from './published-listing-details'
import resaleStyles from './resale-management.module.css'
import shopStyles from './shop-management.module.css'
import { WorkspaceEmpty } from './workspace-empty'

const auxiliaryPages = new Map([
  ['favorites', <Favorites key="favorites" channel="resale" />],
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
function shouldShowShopDemo(channel: string, demoProducts?: Listing[]) {
  return Boolean(demoProducts?.length && channel === 'shop')
}

function ProductSearch({
  value,
  onChange,
}: {
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label
      className={`${styles.field} ${shopStyles.search} ${shopStyles.desktopSearch}`}
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
  tab,
  onTab,
}: {
  search: string
  onSearch: (value: string) => void
  channel: string
  applied: MarketFilterValues
  sort: string
  onSort: (sort: string) => void
  onFilter: (values: MarketFilterValues) => void
  onCreate: () => void
  tab: number
  onTab: (tab: number) => void
}) {
  const [statusOpen, setStatusOpen] = useState(false)
  const [categoryOpen, setCategoryOpen] = useState(false)
  return (
    <div
      className={resaleStyles.managementControls}
      data-resale-toolbar={channel === 'resale' || undefined}
      data-shop-toolbar={channel === 'shop' || undefined}
    >
      {channel === 'shop' && (
        <ProductSearch value={search} onChange={onSearch} />
      )}

      {channel === 'shop' && (
        <FilterInteraction
          label="Status"
          options={[
            { value: 'active', label: 'Active' },
            { value: 'sold', label: 'Sold' },
          ]}
          value={tab === 0 ? 'active' : 'sold'}
          isOpen={statusOpen}
          onOpenChange={setStatusOpen}
          onChange={(value) => onTab(value === 'sold' ? 1 : 0)}
          triggerClassName={`${favoriteStyles.favoriteDropdown} ${resaleStyles.shopFilterPill}`}
          hasChevron={true}
          triggerContent={
            <>
              <CircleCheck size={18} aria-hidden="true" />
              <span>Status</span>
              <ChevronDown size={14} aria-hidden="true" />
            </>
          }
        />
      )}

      {channel === 'shop' && (
        <FilterInteraction
          label="Category"
          options={[
            { value: '', label: 'All Categories' },
            ...listingCategories,
          ]}
          value={applied.category}
          isOpen={categoryOpen}
          onOpenChange={setCategoryOpen}
          onChange={(category) =>
            onFilter({ ...applied, category, subcategory: '' })
          }
          triggerClassName={`${favoriteStyles.favoriteDropdown} ${resaleStyles.shopFilterPill}`}
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

      <ListingSortFilter
        applied={applied}
        sort={sort}
        showSort={true}
        showFilter={channel !== 'shop'}
        overlaySelects={true}
        panelClassName={resaleStyles.filterPanel}
        triggerClassName={`${favoriteStyles.favoriteDropdown} ${resaleStyles.shopFilterPill}`}
        onSort={onSort}
        onFilter={onFilter}
      />
      {channel === 'resale' ? (
        <ShiningButton
          size="compact"
          variant="purple"
          showArrow={false}
          onClick={onCreate}
        >
          <span className={resaleStyles.createContent}>
            <Plus size={16} aria-hidden={true} />
            <span className={resaleStyles.fullCreateLabel}>Create Resale</span>
            <span className={resaleStyles.compactCreateLabel}>Create</span>
          </span>
        </ShiningButton>
      ) : (
        <ShiningButton
          size="compact"
          variant="green"
          showArrow={false}
          onClick={onCreate}
        >
          <span className={resaleStyles.createContent}>
            <Plus size={16} aria-hidden={true} />
            <span className={resaleStyles.fullCreateLabel}>
              Add Shop Product
            </span>
            <span className={resaleStyles.compactCreateLabel}>
              Add Shop Product
            </span>
          </span>
        </ShiningButton>
      )}
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
      <SegmentedControl
        value={tab === 0 ? 'active' : 'sold'}
        items={[
          { value: 'active', label: 'Active' },
          { value: 'sold', label: 'Sold' },
        ]}
        onChange={(value) => onTab(value === 'active' ? 0 : 1)}
        ariaLabel="Listing status"
      />
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

/** Owner-only detail view: shared motion/dialog behavior without buyer actions or view tracking. */
function OwnerProductPreview({
  listing,
  onClose,
  restoreFocusTo,
}: {
  listing: Listing | null
  onClose: () => void
  restoreFocusTo: HTMLElement | null
}) {
  return (
    <AnimatePresence>
      {listing && (
        <div className={styles.previewSource} aria-hidden="true">
          <ExpandableCard
            key={listing.id}
            openOnMount
            hideActions
            title={
              listing.price === 0
                ? 'Free'
                : `$${(listing.price / 100).toFixed(2)}`
            }
            expandedTitle={listing.title}
            expandedEyebrow={null}
            triggerLabel={`Preview ${listing.title}`}
            media={
              <ListingMedia
                images={listing.photoUrls.slice(0, 1)}
                alt={listing.title}
              />
            }
            expandedMedia={
              <ListingMedia images={listing.photoUrls} alt={listing.title} />
            }
            renderTopAction={(close) => (
              <button
                type="button"
                className={styles.ownerPreviewClose}
                aria-label="Close product preview"
                onClick={close}
              >
                <X size={20} aria-hidden="true" />
              </button>
            )}
            onOverlayActiveChange={(active) => {
              if (!active) onClose()
            }}
            restoreFocusTo={restoreFocusTo}
            fadeReturningMedia
          >
            <PublishedListingDetails listing={listing} showPrice />
          </ExpandableCard>
        </div>
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
  const [inventoryProduct, setInventoryProduct] = useState<Listing | null>(null)
  const [preview, setPreview] = useState<Listing | null>(null)
  const [previewReturnFocus, setPreviewReturnFocus] =
    useState<HTMLElement | null>(null)
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
  const showInjectedShopDemo = shouldShowShopDemo(channel, demoProducts)
  const editing = Boolean(edit)
  const [search, setSearch] = useState('')
  const [shopPage, setShopPage] = useState(1)
  const shopPageSize = 8
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
    if (showInjectedShopDemo) {
      setItems(demoProducts || [])
      setError('')
      setLoading(false)
      return
    }
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
  }, [channel, demoProducts, showInjectedShopDemo])

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
    setPreview(null)
    setPreviewReturnFocus(null)
    setConfirmation(null)
  }, [page])

  async function manage() {
    if (!confirmation || pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const { listing, action } = confirmation
      if (showInjectedShopDemo) {
        setItems((current) =>
          action === 'delete'
            ? current.filter((item) => item.id !== listing.id)
            : current.map((item) =>
                item.id === listing.id ? { ...item, status: 'sold' } : item
              )
        )
        setNotice(
          action === 'delete'
            ? 'Demo product removed locally'
            : 'Demo product marked as sold locally'
        )
        setConfirmation(null)
        return
      }
      if (action === 'delete') {
        await deleteListing(listing.id)
        setItems((current) => current.filter((item) => item.id !== listing.id))
        setNotice(
          listing.listingChannel === 'shop'
            ? 'Product archived'
            : 'Listing deleted'
        )
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

  if (page === 'shop-favorites')
    return <ShopFavorites key={page} demo={Boolean(demoProducts?.length)} />
  const auxiliary = auxiliaryPages.get(page)
  if (auxiliary) return auxiliary
  const showShopDemo = showInjectedShopDemo
  const managementItems = items
  const shopStats =
    channel === 'shop'
      ? {
          total: managementItems.length,
          active: managementItems.filter((item) => item.status === 'available')
            .length,
          sold: managementItems.filter((item) => item.status === 'sold').length,
          lowStock: managementItems.filter(
            (item) =>
              item.inventory &&
              item.inventory.lowStockThreshold > 0 &&
              item.inventory.availableQuantity > 0 &&
              item.inventory.availableQuantity <=
                item.inventory.lowStockThreshold
          ).length,
        }
      : null
  const filtered = managementItems
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
  const shopPages = Math.max(1, Math.ceil(filtered.length / shopPageSize))
  const activeShopPage = Math.min(shopPage, shopPages)
  const visible =
    channel === 'shop'
      ? filtered.slice(
          (activeShopPage - 1) * shopPageSize,
          activeShopPage * shopPageSize
        )
      : filtered

  const gridClass = managementGrid()
  return (
    <section
      className={`${styles.workspace} ${
        channel === 'shop' ? shopStyles.workspace : ''
      }`}
      aria-label={scope.label}
      data-management-channel={channel}
    >
      {shopStats && (
        <div className={shopStyles.stats} aria-label="Product statistics">
          <div>
            <span className={shopStyles.statIcon} data-tone="purple">
              <Package size={20} aria-hidden="true" />
            </span>
            <span>
              <small>Total Products</small>
              <strong>{shopStats.total}</strong>
            </span>
          </div>
          <div>
            <span className={shopStyles.statIcon} data-tone="green">
              <CircleCheck size={20} aria-hidden="true" />
            </span>
            <span>
              <small>Active</small>
              <strong>{shopStats.active}</strong>
            </span>
          </div>
          <div>
            <span className={shopStyles.statIcon} data-tone="mint">
              <Check size={20} aria-hidden="true" />
            </span>
            <span>
              <small>Sold</small>
              <strong>{shopStats.sold}</strong>
            </span>
          </div>
          <div>
            <span className={shopStyles.statIcon} data-tone="amber">
              <ListFilter size={20} aria-hidden="true" />
            </span>
            <span>
              <small>Low stock</small>
              <strong>{shopStats.lowStock}</strong>
            </span>
          </div>
        </div>
      )}
      {channel === 'shop' ? (
        <ManagementTools
          channel={channel}
          applied={applied}
          sort={sort}
          search={search}
          onSort={(value) => {
            setSort(value)
            setShopPage(1)
          }}
          onFilter={(values) => {
            setApplied(values)
            setShopPage(1)
          }}
          onCreate={() => setCreationOpen(true)}
          onSearch={(value) => {
            setSearch(value)
            setShopPage(1)
          }}
          tab={tab}
          onTab={(value) => {
            setTab(value)
            setShopPage(1)
          }}
        />
      ) : (
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
            tab={tab}
            onTab={setTab}
          />
        </ManagementStatus>
      )}
      <LocalTabContent tab={tab}>
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
        {!loading && !error && !filtered.length && (
          <WorkspaceEmpty className={reveal}>
            {managementEmptyMessage(channel, tab, applied, search)}
          </WorkspaceEmpty>
        )}
        {channel === 'shop' ? (
          <div className={reveal} hidden={!visible.length}>
            <ShopProductTable
              items={visible}
              demo={showShopDemo}
              onPreview={(listing, trigger) => {
                setPreviewReturnFocus(trigger)
                setPreview(listing)
              }}
              onCost={setCostProduct}
              onInventory={setInventoryProduct}
              onEdit={setEdit}
              onDelete={(listing) => {
                setError('')
                setConfirmation({ listing, action: 'delete' })
              }}
              onMarkSold={(listing) => {
                setError('')
                setConfirmation({ listing, action: 'sold' })
              }}
            />
          </div>
        ) : (
          <div className={`${gridClass} ${reveal}`} hidden={!visible.length}>
            {visible.map((listing) => (
              <ResaleManagementCard
                key={listing.id}
                listing={listing}
                channel={channel}
                onEdit={() => setEdit(listing)}
                onDelete={() => {
                  setError('')
                  setConfirmation({ listing, action: 'delete' })
                }}
              />
            ))}
          </div>
        )}
        {channel === 'shop' && filtered.length > shopPageSize && (
          <nav className={shopStyles.pagination} aria-label="Product pages">
            <button
              type="button"
              disabled={activeShopPage === 1}
              onClick={() => setShopPage((page) => Math.max(1, page - 1))}
            >
              Previous
            </button>
            <span>
              Page {activeShopPage} of {shopPages}
            </span>
            <button
              type="button"
              disabled={activeShopPage === shopPages}
              onClick={() =>
                setShopPage((page) => Math.min(shopPages, page + 1))
              }
            >
              Next
            </button>
          </nav>
        )}
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
        {inventoryProduct && (
          <ProductInventoryDialog
            key={inventoryProduct.id}
            listing={inventoryProduct}
            onClose={() => setInventoryProduct(null)}
            onSaved={(inventory) => {
              setItems((current) =>
                current.map((item) =>
                  item.id === inventoryProduct.id
                    ? {
                        ...item,
                        inventory,
                        inventoryStatus:
                          inventory.availableQuantity <= 0
                            ? 'out_of_stock'
                            : inventory.lowStockThreshold > 0 &&
                              inventory.availableQuantity <=
                                inventory.lowStockThreshold
                            ? 'low_stock'
                            : 'in_stock',
                      }
                    : item
                )
              )
            }}
          />
        )}
      </AnimatePresence>
      <OwnerProductPreview
        listing={preview}
        restoreFocusTo={previewReturnFocus}
        onClose={() => {
          setPreview(null)
          setPreviewReturnFocus(null)
        }}
      />
      <AnimatePresence>
        {creationOpen && (
          <ListingCreationSheet
            mode={channel}
            previewOnly={showShopDemo}
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
                : confirmation.listing.listingChannel === 'shop'
                ? 'Archive this product?'
                : 'Delete this listing?'
            }
            confirm={
              confirmation.action === 'sold'
                ? 'Mark as sold'
                : confirmation.listing.listingChannel === 'shop'
                ? 'Archive product'
                : 'Delete'
            }
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
              : confirmation.listing.listingChannel === 'shop'
              ? 'It will be removed from public browsing and product management. Inventory and audit history are preserved.'
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
