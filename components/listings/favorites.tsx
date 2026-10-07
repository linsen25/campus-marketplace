import { useCallback, useEffect, useRef, useState } from 'react'

import { ContentLoadingSpinner } from '@/components/ui/content-loading-spinner'
import { useContentReveal } from '@/components/ui/content-reveal'
import { getFavoriteListings } from '@/lib/favorites-api'
import type { Listing } from '@/types/listing'

import { CardAction } from './card-actions'
import { ContentStateError } from './content-state-error'
import { ListingSortFilter } from './listing-sort-filter'
import styles from './listing-workspace.module.css'
import type { MarketFilterValues } from './market-filter'
import { PublishedListingCard } from './published-listing-card'
import { ContentStateRegion, WorkspaceEmpty } from './workspace-empty'

export function Favorites() {
  const [items, setItems] = useState<Listing[]>([])
  const [applied, setApplied] = useState<MarketFilterValues>({
    category: '',
    subcategory: '',
    place: '',
    condition: '',
  })
  const [sort, setSort] = useState('newest')
  const [page, setPage] = useState(1)
  const [hasNext, setHasNext] = useState(false)
  const [loading, setLoading] = useState(true)
  const reveal = useContentReveal(loading)
  const [error, setError] = useState('')
  const version = useRef(0)
  const load = useCallback(async () => {
    const request = ++version.current
    setError('')
    try {
      const result = await getFavoriteListings({
        ...(applied.category
          ? { category: applied.category as Listing['category'] }
          : {}),
        ...(applied.subcategory
          ? { subcategory: applied.subcategory as Listing['subcategory'] }
          : {}),
        ...(applied.condition
          ? { condition: applied.condition as Listing['condition'] }
          : {}),
        ...(applied.place ? { place: applied.place } : {}),
        sort: sort as 'newest' | 'price-asc' | 'price-desc',
        page,
        pageSize: 20,
      })
      if (request !== version.current) return
      setItems(
        result.filter((item) => item.publishedAt && item.status === 'available')
      )
      setHasNext(result.length === 20)
    } catch (reason) {
      if (request === version.current) {
        setItems([])
        setError(
          reason instanceof Error ? reason.message : 'Unable to load favorites.'
        )
      }
    } finally {
      if (request === version.current) setLoading(false)
    }
  }, [applied, sort, page])
  useEffect(() => {
    setLoading(true)
    load()
    const refresh = () => {
      if (document.visibilityState === 'visible') load()
    }
    window.addEventListener('focus', refresh)
    window.addEventListener('marketplace-listings-changed', refresh)
    document.addEventListener('visibilitychange', refresh)
    const interval = setInterval(refresh, 30000)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- Invalidate any in-flight request on cleanup.
      ++version.current
      clearInterval(interval)
      window.removeEventListener('focus', refresh)
      window.removeEventListener('marketplace-listings-changed', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [load])
  return (
    <section
      aria-label="Favorites"
      className={`${styles.workspace} ${styles.favoritesWorkspace}`}
    >
      <div className={`${styles.toolbar} ${styles.favoritesToolbar}`}>
        <ListingSortFilter
          mobileLabels={true}
          applied={applied}
          sort={sort}
          onSort={(value) => {
            setSort(value)
            setPage(1)
          }}
          onFilter={(values) => {
            setApplied(values)
            setPage(1)
          }}
        />
      </div>
      {loading && (
        <ContentStateRegion>
          <ContentLoadingSpinner />
        </ContentStateRegion>
      )}
      {!loading && error && (
        <ContentStateError
          className={reveal}
          onRetry={() => {
            setLoading(true)
            load()
          }}
        >
          Couldn&apos;t load favorites.
        </ContentStateError>
      )}
      {!loading && !error && !items.length && (
        <WorkspaceEmpty className={reveal}>
          {Object.values(applied).some(Boolean) ? (
            <span>
              No listings match your filters.
              <br />
              Try another search or clear the filters.
            </span>
          ) : (
            'No favorites yet.'
          )}
        </WorkspaceEmpty>
      )}
      <div
        className={`${styles.grid} ${reveal}`}
        hidden={loading || !items.length}
      >
        {items.map((listing) => (
          <article key={listing.id}>
            <PublishedListingCard
              listing={listing}
              initiallyFavorited={true}
              onUnfavorite={(id) =>
                setItems((current) => current.filter((item) => item.id !== id))
              }
            />
          </article>
        ))}
      </div>
      {(page > 1 || hasNext) && (
        <nav className={styles.actions} aria-label="Favorite pages">
          <CardAction
            disabled={page === 1 || loading}
            onClick={() => setPage((current) => current - 1)}
          >
            Previous
          </CardAction>
          <CardAction
            disabled={!hasNext || loading}
            onClick={() => setPage((current) => current + 1)}
          >
            Next
          </CardAction>
        </nav>
      )}
    </section>
  )
}
