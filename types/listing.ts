import type { MarketCategory, MarketSubcategory } from '@/lib/market-taxonomy'
import type { MeetingArea, MeetingLocation } from '@/types/meeting-location'
import type { ShopListingIdentity } from '@/types/shop'

export type ListingCategory = MarketCategory
export type ListingSubcategory = MarketSubcategory

export type ListingCondition = 'fair' | 'good' | 'like-new' | 'new'

export type ListingStatus = 'available' | 'pending' | 'reserved' | 'sold'
export type ListingChannel = 'resale' | 'shop'
/**
 * `external` is retained only for listings created before the named
 * in-person and Interac preferences were introduced.
 */
export type ListingPaymentMode =
  | 'external'
  | 'in_person'
  | 'interac_etransfer'
  | 'uu_pay'

/** Owner-only quantities from the C2 inventory RPC. Never present for Resale. */
export type ShopInventory = {
  onHandQuantity: number
  reservedQuantity: number
  availableQuantity: number
  lowStockThreshold: number
  revision: number
  updatedAt: string
}

/** Public Shop browsing deliberately exposes only this non-sensitive state. */
export type ShopInventoryStatus = 'in_stock' | 'low_stock' | 'out_of_stock'

export type SellerSummary = {
  id: string
  displayName: string
  uwoEmailVerified?: boolean
}

export type Listing = {
  id: string
  listingChannel: ListingChannel
  title: string
  description: string
  /** Non-negative integer cents; zero means free. */
  price: number
  currency: 'CAD'
  category: ListingCategory
  /** Optional within a required marketplace category. */
  subcategory?: ListingSubcategory
  condition?: ListingCondition
  pickupArea?: string
  preferredPaymentMode?: ListingPaymentMode
  preferredFulfillment?: 'DELIVERY' | 'ON_CAMPUS'
  /** Applies only when preferredFulfillment is ON_CAMPUS (the legacy Meeting value). */
  meetingArea?: MeetingArea | null
  meetingLocation?: MeetingLocation | null
  /** Optional instructions such as an entrance, floor, or room; never a place reference. */
  meetingLocationDetail?: string | null
  estimatedDeliveryFeeCents?: number
  photoUrls: string[]
  seller: SellerSummary
  /** Present only when a public Shop projection has authorized navigation. */
  shop?: ShopListingIdentity | null
  /** Full quantities are attached only to an authenticated Shop owner's DTO. */
  inventory?: ShopInventory
  /** Public Shop listings disclose a status, never quantities or reservations. */
  inventoryStatus?: ShopInventoryStatus
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
  /** No implicit scope: Favorites and owner compatibility reads may span channels. */
  channel?: ListingChannel
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
  | 'createdAt'
  | 'id'
  | 'listingChannel'
  | 'publishedAt'
  | 'seller'
  | 'status'
  | 'updatedAt'
>

export type OwnerListingQuery = Pick<ListingQuery, 'channel'>

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
