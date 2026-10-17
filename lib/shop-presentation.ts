import type { ActivityPeriod } from './account-activity'

/** Presentation contract only; never account-wide analytics or entitlement.
 * Views: intentional public /shop/<username> visits, excluding the owner and
 * Settings/Profile/Analysis/management/preview traffic. Instrumentation is not
 * implemented in this UI phase. Top listings: listing views scoped to this Shop.
 */
export type ShopAnalytics = {
  sellerProfileId: string
  period: ActivityPeriod
  views: Array<{ timestamp: string; label: string; views: number }>
  topListings: Array<{ listingId: string; title: string; views: number }>
}

/** Isolated UI qualification seam. No application provider implements this yet. */
export type ShopAnalyticsFixtureLoader = (
  period: ActivityPeriod
) => Promise<ShopAnalytics>

export const shopCategories = [
  'Clothing & Accessories',
  'Electronics',
  'Collectibles',
  'Home & Living',
] as const
export type ShopIdentity = {
  shopName: string
  category: string
  description: string
}

export function shopIdentityError(value: ShopIdentity): string {
  if (!value.shopName.trim() || value.shopName.trim().length > 40)
    return 'Use a Shop name between 1 and 40 characters.'
  if (!shopCategories.some((category) => category === value.category))
    return 'Choose a Shop category.'
  if (!value.description.trim() || value.description.trim().length > 200)
    return 'Use a description between 1 and 200 characters.'
  return ''
}

export function shopPath(username: string) {
  return `/shop/${encodeURIComponent(username)}`
}
