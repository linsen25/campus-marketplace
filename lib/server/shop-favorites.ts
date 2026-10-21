import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { shopProjection } from '@/lib/server/public-shop'
import { shopUuid } from '@/lib/shop-favorites-api'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'

export function createShopFavoritesRepository(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  async function call(name: string, args: Record<string, unknown>) {
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, args)
    if (error) {
      if (['23514', '22P02'].includes(error.code))
        throw new ListingApiError('Invalid Shop favorite request.', 400)
      if (error.code === '42501')
        throw new ListingApiError('Verified login required.', 403)
      if (error.code === 'P0002')
        throw new ListingApiError('Shop unavailable.', 404)
      throw new ListingApiError(
        'Shop favorites unavailable. Please retry.',
        503
      )
    }
    if (!data || typeof data !== 'object' || Array.isArray(data))
      throw new ListingApiError('Shop favorites unavailable.', 503)
    return data as Record<string, unknown>
  }
  return {
    async list(query: { page: number; pageSize: number }) {
      const data = await call('marketplace_favorite_shops', { p_query: query })
      if (
        !Array.isArray(data.shops) ||
        !Number.isSafeInteger(data.page) ||
        typeof data.hasNextPage !== 'boolean' ||
        typeof data.refreshAfterMs !== 'number'
      )
        throw new ListingApiError('Shop favorites unavailable.', 503)
      return {
        shops: data.shops.map(shopProjection),
        page: data.page as number,
        hasNextPage: data.hasNextPage,
        refreshAfterMs: Math.max(100, Math.min(30000, data.refreshAfterMs)),
      }
    },
    async states(ids: string[]) {
      const data = await call('marketplace_shop_favorite_states', {
        p_shop_ids: ids,
      })
      if (
        !Array.isArray(data.favoriteShopIds) ||
        data.favoriteShopIds.some(
          (id) =>
            typeof id !== 'string' || !shopUuid.test(id) || !ids.includes(id)
        )
      )
        throw new ListingApiError('Shop favorites unavailable.', 503)
      return { favoriteShopIds: data.favoriteShopIds as string[] }
    },
    async set(id: string, enabled: boolean) {
      const data = await call('marketplace_set_shop_favorite', {
        p_shop_id: id,
        p_enabled: enabled,
      })
      if (data.shopId !== id || data.favorited !== enabled)
        throw new ListingApiError('Unable to confirm Shop favorite.', 503)
      return { shopId: id, favorited: enabled }
    },
  }
}
