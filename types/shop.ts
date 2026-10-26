import type { Listing } from './listing'

/** Persistent owner profile only; not Pro entitlement or public eligibility. */
export type OwnerShop = {
  id: string
  ownerId: string
  name: string
  category: string
  description: string
  createdAt: string
  updatedAt: string
}

export type UpdateShopProfileInput = Partial<
  Pick<OwnerShop, 'category' | 'description' | 'name'>
>
export type CreateShopProfileInput = Pick<
  OwnerShop,
  'category' | 'description' | 'name'
>

/** Public presentation only. Not membership, billing, or activation authority. */
export type ShopPreview = {
  id?: string
  badgeTier?: 'plus' | 'pro'
  sellerProfileId: string
  username: string
  shopName: string
  category: string
  description: string
  uwoEmailVerified?: boolean
  imageUrl?: string
  avatarUrl?: string
}

export type PublicShop = {
  shop: ShopPreview
  listings: Listing[]
  page?: number
  hasNextPage?: boolean
  refreshAfterMs?: number
}

export type PublicShopQuery = {
  page?: number
  pageSize?: number
  search?: string
  categories?: string[]
  sort?: 'newest' | 'price-high' | 'price-low'
}
export type PublicShopDirectory = {
  shops: ShopPreview[]
  page: number
  hasNextPage: boolean
  refreshAfterMs: number
}
export type PublicShopResult =
  | { state: 'not_found' }
  | { state: 'unavailable' }
  | (PublicShop & { state: 'available' })
export type PublicShopProducts = {
  state: 'available'
  listings: Listing[]
  page: number
  hasNextPage: boolean
  refreshAfterMs: number
}
export type PublicShopListingResult =
  | { state: 'available'; listing: Listing; refreshAfterMs: number }
  | { state: 'not_found' }
  | { state: 'unavailable' }
