import type { PublicShop, ShopPreview } from '@/types/shop'

// No Shop authority exists yet. Do not infer activation from profiles/listings.
// Replace this empty source with authoritative active Shops in the later phase.
// UI fixtures are injected in offline tests only, never read by these routes.
export function getPublicShops(): ShopPreview[] {
  return []
}

export function getPublicShop(username: string): PublicShop | null {
  if (!/^[a-z0-9_]{1,64}$/i.test(username)) return null
  return null
}
