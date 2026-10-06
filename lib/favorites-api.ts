import { marketplaceRequest } from '@/lib/listings-api'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type { Listing, ListingQuery } from '@/types/listing'

export type FavoritesQuery = Omit<ListingQuery, 'sort' | 'status'> & {
  place?: string
  sort?: ListingQuery['sort'] | 'price-asc' | 'price-desc'
}

export function favoriteListingQuery(query: FavoritesQuery): ListingQuery {
  let sort: ListingQuery['sort']
  if (query.sort === 'price-asc') sort = 'price-low'
  else if (query.sort === 'price-desc') sort = 'price-high'
  else sort = query.sort
  const { place, ...filters } = query
  return {
    ...filters,
    pickupArea: filters.pickupArea ?? place,
    sort,
    status: 'available',
  }
}

async function repository(context?: MarketplaceContext) {
  if (!context) throw new Error('A request context is required.')
  const { createSupabaseListingsRepository } = await import(
    /* webpackChunkName: 'supabase-listings-repository' */ '@/lib/server/supabase-listings-repository'
  )
  return createSupabaseListingsRepository(context)
}

export async function getFavoriteListings(
  query: FavoritesQuery = {},
  context: MarketplaceContext | undefined = undefined
): Promise<Listing[]> {
  if (typeof window === 'undefined')
    return (await repository(context)).getFavoriteListings(
      favoriteListingQuery(query)
    )
  const params = new URLSearchParams()
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value))
  })
  return marketplaceRequest(`/api/favorites?${params}`, 'GET')
}

export async function favoriteState(
  id: string,
  context?: MarketplaceContext
): Promise<{ favorited: boolean }> {
  if (typeof window === 'undefined')
    return (await repository(context)).favoriteState(id)
  return marketplaceRequest(`/api/favorites/${encodeURIComponent(id)}`, 'GET')
}

export async function setFavorite(
  id: string,
  enabled: boolean,
  context?: MarketplaceContext
): Promise<{ favorited: boolean }> {
  if (typeof window === 'undefined')
    return (await repository(context)).setFavorite(id, enabled)
  return marketplaceRequest(
    `/api/favorites/${encodeURIComponent(id)}`,
    enabled ? 'POST' : 'DELETE'
  )
}
