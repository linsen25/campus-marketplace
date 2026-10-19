/** Shop browsing taxonomy, independent of product Listing categories. */
export const SHOP_CATEGORIES = [
  'Fashion & Accessories',
  'Tech & Electronics',
  'Home & Dorm',
  'Beauty & Personal Care',
  'Books & Stationery',
  'Art, Crafts & Gifts',
  'Sports & Outdoors',
  'Collectibles & Hobbies',
  'Food & Treats',
  'Other',
] as const
export type ShopCategory = typeof SHOP_CATEGORIES[number]
export const shopDirectorySorts = [
  { value: 'recommended', label: 'Recommended' },
  { value: 'highest-rated', label: 'Highest Rated' },
  { value: 'best-selling', label: 'Best Selling' },
] as const
export type ShopDirectoryQuery = {
  sort: typeof shopDirectorySorts[number]['value']
  categories: ShopCategory[]
}
export const defaultShopDirectoryQuery: ShopDirectoryQuery = {
  sort: 'recommended',
  categories: [],
}

/** Compatibility projection only; does not rewrite persisted legacy categories. */
const legacyCategories: Record<string, ShopCategory> = {
  'Clothing & Accessories': 'Fashion & Accessories',
  Electronics: 'Tech & Electronics',
  Collectibles: 'Collectibles & Hobbies',
  'Home & Living': 'Home & Dorm',
}
export function shopDirectoryCategory(category: string): string {
  return legacyCategories[category] ?? category
}
export function browseShops<
  T extends {
    category: string
    figures?: { rating: string; reviews: number; sold: number }
  }
>(shops: readonly T[], query: ShopDirectoryQuery): T[] {
  const filtered = shops.filter(
    (shop) =>
      !query.categories.length ||
      query.categories.some(
        (category) => category === shopDirectoryCategory(shop.category)
      )
  )
  if (query.sort === 'recommended') return filtered
  return filtered.sort((a, b) => {
    const rating =
      Number(b.figures?.rating ?? 0) - Number(a.figures?.rating ?? 0)
    const reviews = (b.figures?.reviews ?? 0) - (a.figures?.reviews ?? 0)
    const sold = (b.figures?.sold ?? 0) - (a.figures?.sold ?? 0)
    return query.sort === 'highest-rated'
      ? rating || reviews || sold
      : sold || rating || reviews
  })
}
