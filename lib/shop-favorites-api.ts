import { marketplaceRequest } from '@/lib/listings-api'
import type { PublicShopDirectory } from '@/types/shop'

export type ShopFavoriteStates = { favoriteShopIds: string[] }
export type ShopFavoriteResult = { shopId: string; favorited: boolean }

export const shopUuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readFavoriteShops(page = 1): Promise<PublicShopDirectory> {
  return marketplaceRequest(
    `/api/shop-favorites?page=${page}&pageSize=20`,
    'GET'
  )
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
