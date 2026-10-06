import type { MarketCategory, MarketSubcategory } from '@/lib/market-taxonomy'

export type ListingCategory = MarketCategory
export type ListingSubcategory = MarketSubcategory

export type ListingCondition = 'fair' | 'good' | 'like-new' | 'new'

export type ListingStatus = 'available' | 'sold'

export type SellerSummary = {
  id: string
  displayName: string
}

export type Listing = {
  id: string
  title: string
  description: string
  /** Non-negative integer cents; zero means free. */
  price: number
  currency: 'CAD'
  category: ListingCategory
  subcategory: ListingSubcategory
  condition?: ListingCondition
  pickupArea: string
  photoUrls: string[]
  seller: SellerSummary
  status: ListingStatus
  /** ISO 8601 timestamps. */
  createdAt: string
  updatedAt: string
  /** Internal creation state; real database reads always include these fields. */
  publishedAt?: string | null
  expectedImageCount?: number
}

export type ListingSort = 'newest' | 'price-high' | 'price-low'

export type ListingQuery = {
  search?: string
  pickupArea?: string
  category?: ListingCategory
  subcategory?: ListingSubcategory
  condition?: ListingCondition
  /** Inclusive bounds in non-negative integer cents. */
  minPrice?: number
  maxPrice?: number
  status?: ListingStatus
  /** Defaults to newest. */
  sort?: ListingSort
  /** One-based page number; defaults to 1. */
  page?: number
  /** Defaults to 20. */
  pageSize?: number
}

// IDs, status, timestamps, and seller identity will be assigned by the backend.
export type CreateListingInput = Omit<
  Listing,
  'createdAt' | 'id' | 'publishedAt' | 'seller' | 'status' | 'updatedAt'
>

export type UpdateListingInput = Partial<
  Omit<
    CreateListingInput,
    | 'category'
    | 'condition'
    | 'currency'
    | 'expectedImageCount'
    | 'photoUrls'
    | 'subcategory'
  >
> & {
  /** Explicit null clears the optional condition over JSON. */
  condition?: ListingCondition | null
}
