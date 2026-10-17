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

/** Public presentation only. Not membership, billing, or activation authority. */
export type ShopPreview = {
  sellerProfileId: string
  username: string
  shopName: string
  category: string
  description: string
  imageUrl?: string
  avatarUrl?: string
}

export type PublicShop = {
  shop: ShopPreview
  listings: Listing[]
}
