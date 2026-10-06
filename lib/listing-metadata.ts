import { marketCategories } from '@/lib/market-taxonomy'
import type { ListingCondition, ListingSort } from '@/types/listing'

export const listingCategories = marketCategories.map((value) => ({
  value,
  label: value,
}))

export const listingConditions: Array<{
  value: ListingCondition
  label: string
}> = [
  { value: 'new', label: 'New' },
  { value: 'like-new', label: 'Like New' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
]

export const listingSorts: Array<{ value: ListingSort; label: string }> = [
  { value: 'newest', label: 'Newest' },
  { value: 'price-low', label: 'Price: Low to High' },
  { value: 'price-high', label: 'Price: High to Low' },
]
