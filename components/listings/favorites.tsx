import { useCallback, useEffect, useRef, useState } from 'react'

import { useContentReveal } from '@/components/ui/content-reveal'
import { ListingSkeletonGrid } from '@/components/ui/workspace-skeletons'
import { getFavoriteListings } from '@/lib/favorites-api'
import type { Listing } from '@/types/listing'

import { CardAction } from './card-actions'
import { ContentStateError } from './content-state-error'
import favoritesStyles from './favorites.module.css'
import styles from './listing-workspace.module.css'
import { PublishedListingCard } from './published-listing-card'
import { WorkspaceEmpty } from './workspace-empty'

export function Favorites() {
  const [items, setItems] = useState<Listing[]>([])
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
        sort: 'newest',
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
        setError(
          reason instanceof Error ? reason.message : 'Unable to load favorites.'
        )
      }
    } finally {
      if (request === version.current) setLoading(false)
    }
  }, [page])
  useEffect(() => {
    setLoading(true)
    setItems([])
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
      {loading && (
        <ListingSkeletonGrid
          className={`${styles.grid} ${favoritesStyles.grid}`}
        />
      )}
      {!loading && error && (
        <ContentStateError
          className={reveal}
          onRetry={() => {
            setLoading(!items.length)
            load()
          }}
        >
          Couldn&apos;t load favorites.
        </ContentStateError>
      )}
      {!loading && !error && !items.length && (
        <WorkspaceEmpty className={reveal}>No favorites yet.</WorkspaceEmpty>
      )}
      <div
        className={`${styles.grid} ${favoritesStyles.grid} ${reveal}`}
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
