import type {
  ListingCategory,
  ListingCondition,
  ListingSort,
} from '@/types/listing'

export const listingCategories: Array<{
  value: ListingCategory
  label: string
}> = [
  { value: 'furniture', label: 'Furniture' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'books', label: 'Books' },
  { value: 'clothing', label: 'Clothing' },
  { value: 'home-kitchen', label: 'Home & Kitchen' },
  { value: 'free', label: 'Free' },
  { value: 'sports-hobbies', label: 'Sports & Hobbies' },
  { value: 'other', label: 'Other' },
]

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
