import { useEffect, useState } from 'react'

import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import { useAuthModal } from '@/components/auth/auth-modal'
import { CardAction } from '@/components/listings/card-actions'
import { ContentStateError } from '@/components/listings/content-state-error'
import { Favorites } from '@/components/listings/favorites'
import workspace from '@/components/listings/listing-workspace.module.css'
import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { WorkspaceEmpty } from '@/components/listings/workspace-empty'
import { usePublicShopRead } from '@/hooks/use-public-shop-read'
import { useShopFavoritesAccount } from '@/hooks/use-shop-favorites'
import { readFavoriteShops } from '@/lib/shop-favorites-api'

import { ShopCard } from './shop-card'
import grid from './shop-detail-demo.module.css'

function SavedShops() {
  const { actor, listRevision } = useShopFavoritesAccount()
  const [page, setPage] = useState(1)
  const result = usePublicShopRead(`${actor}:${page}:${listRevision}`, () =>
    readFavoriteShops(page)
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
      {(page > 1 || result.data?.hasNextPage) && (
        <nav className={workspace.actions} aria-label="Favorite Shop pages">
          <CardAction
            disabled={page === 1 || result.loading}
            onClick={() => setPage((p) => p - 1)}
          >
            Previous
          </CardAction>
          <CardAction
            disabled={!result.data?.hasNextPage || result.loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </CardAction>
        </nav>
      )}
    </section>
  )
}

export function ShopFavorites() {
  const [tab, setTab] = useState(0)
  const { seller, loading } = useMarketplaceSession()
  const { openAuth } = useAuthModal()
  let content = <SavedShops key={seller?.id} />
  if (tab === 1) content = <Favorites channel="shop" />
  else if (loading) content = <p role="status">Loading favorite shops...</p>
  else if (!seller)
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
      <FluidTabs activeIndex={tab} onActiveIndexChange={setTab}>
        <FluidTabs.List aria-label="Shop Favorites type">
          <FluidTabs.Tab>
            <FluidTabs.Label>Shops</FluidTabs.Label>
          </FluidTabs.Tab>
          <FluidTabs.Tab>
            <FluidTabs.Label>Products</FluidTabs.Label>
          </FluidTabs.Tab>
        </FluidTabs.List>
      </FluidTabs>
      {content}
    </section>
  )
}
