import { marketplaceRequest } from '@/lib/listings-api'
import type { ShopInventory } from '@/types/listing'

export const getShopInventory = (listingId: string) =>
  marketplaceRequest<ShopInventory>(
    `/api/shop/inventory?listingId=${encodeURIComponent(listingId)}`,
    'GET'
  )

export const adjustShopInventory = (
  listingId: string,
  change: { actionId: string; delta: number; expectedRevision: number }
) =>
  marketplaceRequest<ShopInventory>(
    `/api/shop/inventory?listingId=${encodeURIComponent(listingId)}`,
    'PATCH',
    change
  )
