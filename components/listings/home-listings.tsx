import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'

import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import { ContentLoadingSpinner } from '@/components/ui/content-loading-spinner'
import { useContentReveal } from '@/components/ui/content-reveal'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import {
  deleteListing,
  getMyListings,
  markListingSold,
} from '@/lib/listings-api'
import type { Listing } from '@/types/listing'

import { ContentStateError } from './content-state-error'
import { Favorites } from './favorites'
import { ListingConfirmation } from './listing-confirmation'
import { ListingForm } from './listing-form'
import type { ListingLeaveGuard } from './listing-form'
import { ListingSortFilter } from './listing-sort-filter'
import styles from './listing-workspace.module.css'
import type { MarketFilterValues } from './market-filter'
import { PublishedListingCard } from './published-listing-card'
import { ContentStateRegion, WorkspaceEmpty } from './workspace-empty'

export function HomeListings({
  page,
  onSelect,
  onGuardChange,
}: {
  page: string
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
  const load = useCallback(async () => {
    const request = ++version.current
    try {
      const result = await getMyListings()
      if (request === version.current) {
        setItems(result.filter((item) => item.publishedAt))
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
  }, [])
  useEffect(() => {
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
  }, [load])
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
    ++version.current
    setItems((current) => [
      listing,
      ...current.filter((item) => item.id !== listing.id),
    ])
    setNotice(edit ? 'Changes saved' : 'Listing created')
    setEdit(null)
    setTab(0)
    onSelect('my-listings')
  }
  if (page === 'favorites') return <Favorites />
  if (page === 'create-listing' || edit)
    return (
      <ListingForm
        key={edit?.id ?? 'create'}
        listing={edit ?? undefined}
        onCancel={() => {
          setEdit(null)
          onSelect('my-listings')
        }}
        onSaved={saved}
        onGuardChange={onGuardChange}
      />
    )
  const visible = items
    .filter(
      (item) =>
        item.status === (tab === 0 ? 'available' : 'sold') &&
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
  const emptyTabMessage =
    tab === 0 ? 'No active listings yet.' : 'No sold listings yet.'
  return (
    <section className={styles.workspace} aria-label="My Listings">
      <div className={styles.toolbar}>
        <FluidTabs activeIndex={tab} onActiveIndexChange={setTab}>
          <FluidTabs.List aria-label="Listing status">
            <FluidTabs.Tab>
              <FluidTabs.Label>Active</FluidTabs.Label>
            </FluidTabs.Tab>
            <FluidTabs.Tab>
              <FluidTabs.Label>Sold</FluidTabs.Label>
            </FluidTabs.Tab>
          </FluidTabs.List>
        </FluidTabs>
        <ListingSortFilter
          applied={applied}
          sort={sort}
          onSort={setSort}
          onFilter={setApplied}
        />
      </div>
      <LocalTabContent tab={tab}>
        {notice && <p role="status">{notice}</p>}
        {loading && (
          <ContentStateRegion>
            <ContentLoadingSpinner />
          </ContentStateRegion>
        )}
        {!loading && error && !confirmation && (
          <ContentStateError
            className={reveal}
            onRetry={() => {
              setLoading(true)
              load()
            }}
          >
            {error}
          </ContentStateError>
        )}
        {!loading && !error && !visible.length && (
          <WorkspaceEmpty className={reveal}>
            {Object.values(applied).some(Boolean)
              ? 'No listings match your filters.'
              : emptyTabMessage}
          </WorkspaceEmpty>
        )}
        <div className={`${styles.grid} ${reveal}`} hidden={!visible.length}>
          {visible.map((listing) => (
            <article key={listing.id} aria-label={listing.title}>
              <PublishedListingCard listing={listing} owner={true} />
              {listing.status === 'available' ? (
                <div className={styles.sellerActions}>
                  <button type="button" onClick={() => setEdit(listing)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError('')
                      setConfirmation({ listing, action: 'sold' })
                    }}
                  >
                    Mark as sold
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setError('')
                      setConfirmation({ listing, action: 'delete' })
                    }}
                  >
                    Delete
                  </button>
                </div>
              ) : (
                <p>Sold · Read-only</p>
              )}
            </article>
          ))}
        </div>
      </LocalTabContent>
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
