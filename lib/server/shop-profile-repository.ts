import { createHash } from 'crypto'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import {
  validateCreateShopProfile,
  validateShopProfilePatch,
} from '@/lib/shop-profile'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type { OwnerShop } from '@/types/shop'

type ShopProfileRow = {
  id: string
  owner_id: string
  name: string
  category: string
  description: string
  created_at: string
  updated_at: string
}
const selection = 'id,owner_id,name,category,description,created_at,updated_at'

/** Opaque validator; retain PostgreSQL's full timestamp string, never Date.parse. */
export function ownerShopETag(shop: OwnerShop): string {
  return `"shop-${createHash('sha256')
    .update(
      JSON.stringify([
        shop.id,
        shop.ownerId,
        shop.updatedAt,
        shop.name,
        shop.category,
        shop.description,
      ])
    )
    .digest('hex')}"`
}

export function mapOwnerShop(row: ShopProfileRow): OwnerShop {
  return {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    category: row.category,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function checkError(error: { code?: string } | null) {
  if (!error) return
  if (error.code === '42501')
    throw new ListingApiError(
      'You do not have permission to manage this Shop.',
      403
    )
  if (['23514', '23502', '22001'].includes(error.code || ''))
    throw new ListingApiError('Check the Shop profile fields.')
  throw new ListingApiError('Shop profile unavailable. Please retry.', 503)
}

/** Session-bound owner profile access; provisioning grants no activation. */
export function createShopProfileRepository(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  async function read(ownerId: string) {
    const { data, error } = await client
      .from('shops')
      .select<typeof selection, ShopProfileRow>(selection)
      .eq('owner_id', ownerId)
      .maybeSingle()
    checkError(error)
    return data
  }
  return {
    async createOwnShop(input: unknown): Promise<OwnerShop> {
      await requireMarketplaceUser(client)
      const fields = validateCreateShopProfile(input)
      const { data, error } = await client
        .rpc('marketplace_create_shop', { p_input: fields })
        .single<ShopProfileRow>()
      if (error?.code === '23505')
        throw new ListingApiError('Shop already exists.', 409)
      checkError(error)
      if (!data)
        throw new ListingApiError(
          'Shop profile unavailable. Please retry.',
          503
        )
      return mapOwnerShop(data)
    },
    async getOwnShop(): Promise<OwnerShop | null> {
      const user = await requireMarketplaceUser(client)
      const row = await read(user.id)
      return row ? mapOwnerShop(row) : null
    },
    async updateOwnShop(input: unknown, ifMatch?: string): Promise<OwnerShop> {
      const user = await requireMarketplaceUser(client)
      const current = await read(user.id)
      if (!current) throw new ListingApiError('Shop profile not found.', 404)
      const patch = validateShopProfilePatch(input, current)
      if (ifMatch !== undefined && !/^"shop-[a-f0-9]{64}"$/.test(ifMatch))
        throw new ListingApiError('Invalid Shop version.')
      if (
        ifMatch !== undefined &&
        ifMatch !== ownerShopETag(mapOwnerShop(current))
      )
        throw new ListingApiError(
          'Your Shop changed elsewhere. Close and reopen this editor to review the latest information.',
          409
        )
      let update = client.from('shops').update(patch).eq('owner_id', user.id)
      if (ifMatch !== undefined) {
        update = update
          .eq('id', current.id)
          .eq('updated_at', current.updated_at)
          .eq('name', current.name)
          .eq('category', current.category)
          .eq('description', current.description)
      }
      const { data, error } = await update
        .select<typeof selection, ShopProfileRow>(selection)
        .maybeSingle()
      checkError(error)
      if (!data) {
        if (ifMatch !== undefined && (await read(user.id)))
          throw new ListingApiError(
            'Your Shop changed elsewhere. Close and reopen this editor to review the latest information.',
            409
          )
        throw new ListingApiError('Shop profile not found.', 404)
      }
      return mapOwnerShop(data)
    },
  }
}
