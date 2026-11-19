import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'
import type { ShopInventory } from '@/types/listing'

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const whole = (value: unknown, minimum: number, maximum: number) =>
  Number.isSafeInteger(value) &&
  (value as number) >= minimum &&
  (value as number) <= maximum

export function projectShopInventory(value: unknown): ShopInventory {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ListingApiError('Inventory is temporarily unavailable.', 503)
  const item = value as Record<string, unknown>
  const fields = [
    'onHandQuantity',
    'reservedQuantity',
    'availableQuantity',
    'lowStockThreshold',
    'revision',
  ] as const
  if (
    fields.some(
      (key) =>
        !whole(item[key], key === 'revision' ? 1 : 0, Number.MAX_SAFE_INTEGER)
    ) ||
    typeof item.updatedAt !== 'string'
  )
    throw new ListingApiError('Inventory is temporarily unavailable.', 503)
  return {
    onHandQuantity: item.onHandQuantity as number,
    reservedQuantity: item.reservedQuantity as number,
    availableQuantity: item.availableQuantity as number,
    lowStockThreshold: item.lowStockThreshold as number,
    revision: item.revision as number,
    updatedAt: item.updatedAt as string,
  }
}

function databaseError(error: { code?: string; message?: string } | null) {
  if (!error) return
  if (error.code === '42501')
    throw new ListingApiError(
      'You do not have permission to manage this inventory.',
      403
    )
  if (error.code === '40001')
    throw new ListingApiError('Inventory changed. Reload before saving.', 409)
  if (['23514', '22P02', '22003'].includes(error.code || ''))
    throw new ListingApiError(error.message || 'Invalid inventory adjustment.')
  throw new ListingApiError('Inventory is temporarily unavailable.', 503)
}

export function createShopInventoryRepository(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  const read = async (
    listingId: unknown,
    change: Record<string, unknown> | null
  ) => {
    if (typeof listingId !== 'string' || !uuid.test(listingId))
      throw new ListingApiError('A valid product ID is required.')
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc('marketplace_shop_inventory', {
      p_listing_id: listingId,
      p_change: change,
    })
    databaseError(error)
    return projectShopInventory(data)
  }
  return {
    get: (listingId: unknown) => read(listingId, null),
    adjust: (listingId: unknown, input: unknown) => {
      if (!input || typeof input !== 'object' || Array.isArray(input))
        throw new ListingApiError('A valid inventory adjustment is required.')
      const value = input as Record<string, unknown>
      if (
        !uuid.test(typeof value.actionId === 'string' ? value.actionId : '') ||
        !whole(value.delta, -1000000, 1000000) ||
        value.delta === 0 ||
        !whole(value.expectedRevision, 1, Number.MAX_SAFE_INTEGER) ||
        Object.keys(value).some(
          (key) => !['actionId', 'delta', 'expectedRevision'].includes(key)
        )
      )
        throw new ListingApiError('A valid inventory adjustment is required.')
      return read(listingId, value)
    },
  }
}
