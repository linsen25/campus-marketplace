import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { validateShopProfilePatch } from '@/lib/shop-profile'
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

/** Session-bound owner access. No provisioning or activation operation exists. */
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
    async getOwnShop(): Promise<OwnerShop | null> {
      const user = await requireMarketplaceUser(client)
      const row = await read(user.id)
      return row ? mapOwnerShop(row) : null
    },
    async updateOwnShop(input: unknown): Promise<OwnerShop> {
      const user = await requireMarketplaceUser(client)
      const current = await read(user.id)
      if (!current) throw new ListingApiError('Shop profile not found.', 404)
      const patch = validateShopProfilePatch(input, current)
      const { data, error } = await client
        .from('shops')
        .update(patch)
        .eq('owner_id', user.id)
        .select<typeof selection, ShopProfileRow>(selection)
        .maybeSingle()
      checkError(error)
      if (!data) throw new ListingApiError('Shop profile not found.', 404)
      return mapOwnerShop(data)
    },
  }
}
