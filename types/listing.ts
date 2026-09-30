export type ListingCategory =
  | 'books'
  | 'clothing'
  | 'electronics'
  | 'free'
  | 'furniture'
  | 'home-kitchen'
  | 'other'
  | 'sports-hobbies'

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
  condition?: ListingCondition
  pickupArea: string
  photoUrls: string[]
  seller: SellerSummary
  status: ListingStatus
  /** ISO 8601 timestamps. */
  createdAt: string
  updatedAt: string
}

export type ListingSort = 'newest' | 'price-high' | 'price-low'

export type ListingQuery = {
  search?: string
  category?: ListingCategory
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
  'createdAt' | 'id' | 'seller' | 'status' | 'updatedAt'
>

export type UpdateListingInput = Partial<
  Omit<CreateListingInput, 'condition'>
> & {
  /** Explicit null clears the optional condition over JSON. */
  condition?: ListingCondition | null
}
