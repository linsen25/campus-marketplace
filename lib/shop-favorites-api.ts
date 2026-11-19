import { marketplaceRequest } from '@/lib/listings-api'
import type { PublicShopDirectory } from '@/types/shop'

export type ShopFavoriteStates = { favoriteShopIds: string[] }
export type ShopFavoriteResult = { shopId: string; favorited: boolean }

export const shopUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FavoriteShopsQuery = {
  page?: number
  pageSize?: number
  search?: string
  category?: string
  sort?: string
}

export function readFavoriteShops(
  pageOrQuery: number | FavoriteShopsQuery = 1
): Promise<PublicShopDirectory> {
  const query =
    typeof pageOrQuery === 'number' ? { page: pageOrQuery } : pageOrQuery
  const params = new URLSearchParams()
  params.set('page', String(query.page ?? 1))
  params.set('pageSize', String(query.pageSize ?? 20))
  if (query.search?.trim()) params.set('search', query.search.trim())
  if (query.category) params.set('category', query.category)
  if (query.sort && query.sort !== 'newest') params.set('sort', query.sort)
  return marketplaceRequest(`/api/shop-favorites?${params}`, 'GET')
}
export function readShopFavoriteStates(
  ids: string[]
): Promise<ShopFavoriteStates> {
  return marketplaceRequest(
    `/api/shop-favorites?ids=${encodeURIComponent(ids.join(','))}`,
    'GET'
  )
}
export function writeShopFavorite(
  id: string,
  enabled: boolean
): Promise<ShopFavoriteResult> {
  return marketplaceRequest(
    `/api/shop-favorites/${encodeURIComponent(id)}`,
    enabled ? 'POST' : 'DELETE'
  )
}
