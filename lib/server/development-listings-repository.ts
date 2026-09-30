// RETIRED in Phase 4: retained only until hosted Supabase acceptance checks pass.
// No active marketplace code may import this development implementation.
import { listingFixtures } from '@/lib/fixtures/listings'
import {
  listingCategories,
  listingConditions,
  listingSorts,
} from '@/lib/listing-metadata'
import {
  ListingApiError,
  listingInputRecord,
  validateListingInput,
} from '@/lib/listing-validation'
import { getDevelopmentSeller } from '@/lib/server/development-seller'
import type { Listing, ListingQuery } from '@/types/listing'

type DevelopmentStore = { listings: Map<string, Listing>; sequence: number }

function copyListing(listing: Listing): Listing {
  return {
    ...listing,
    seller: { ...listing.seller },
    photoUrls: [...listing.photoUrls],
  }
}

// One temporary store per server process, including across development hot reloads.
// Restarts reset all writes. Never use this as production persistence.
function store(): DevelopmentStore {
  if (typeof window !== 'undefined')
    throw new Error('Development repository is server-only.')
  const scope = globalThis as typeof globalThis & {
    __studentMarketplaceDevelopmentStore?: DevelopmentStore
  }
  if (!scope.__studentMarketplaceDevelopmentStore) {
    scope.__studentMarketplaceDevelopmentStore = {
      listings: new Map(
        listingFixtures.map((listing) => [listing.id, copyListing(listing)])
      ),
      sequence: 0,
    }
  }
  return scope.__studentMarketplaceDevelopmentStore
}

function validateQuery(query: ListingQuery): void {
  const { page = 1, pageSize = 20, sort = 'newest' } = query
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1
  ) {
    throw new ListingApiError(
      'Listing page and pageSize must be positive integers.'
    )
  }
  for (const price of [query.minPrice, query.maxPrice]) {
    if (price !== undefined && (!Number.isSafeInteger(price) || price < 0)) {
      throw new ListingApiError(
        'Price bounds must be non-negative integer cents.'
      )
    }
  }
  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.minPrice > query.maxPrice
  ) {
    throw new ListingApiError('Minimum price must not exceed maximum price.')
  }
  validateQueryOptions(query, sort)
}

function validateQueryOptions(query: ListingQuery, sort: string): void {
  if (
    (query.category !== undefined &&
      !listingCategories.some((item) => item.value === query.category)) ||
    (query.condition !== undefined &&
      !listingConditions.some((item) => item.value === query.condition)) ||
    !listingSorts.some((item) => item.value === sort) ||
    (query.status !== undefined &&
      query.status !== 'available' &&
      query.status !== 'sold') ||
    (query.search !== undefined && typeof query.search !== 'string')
  )
    throw new ListingApiError('Invalid listing query.')
}

export function getListings(query: ListingQuery = {}): Listing[] {
  validateQuery(query)
  const { page = 1, pageSize = 20, sort = 'newest' } = query
  const search = query.search?.trim().toLowerCase()
  const listings = Array.from(store().listings.values()).filter(
    (listing) =>
      (!search ||
        `${listing.title} ${listing.description} ${listing.pickupArea}`
          .toLowerCase()
          .includes(search)) &&
      (!query.category || listing.category === query.category) &&
      (!query.condition || listing.condition === query.condition) &&
      (!query.status || listing.status === query.status) &&
      (query.minPrice === undefined || listing.price >= query.minPrice) &&
      (query.maxPrice === undefined || listing.price <= query.maxPrice)
  )
  listings.sort((a, b) => {
    const newest = Date.parse(b.createdAt) - Date.parse(a.createdAt)
    if (sort === 'price-low') return a.price - b.price || newest
    if (sort === 'price-high') return b.price - a.price || newest
    return newest
  })
  const start = (page - 1) * pageSize
  return listings.slice(start, start + pageSize).map(copyListing)
}

export function getListing(id: string): Listing | null {
  const listing = store().listings.get(id)
  return listing ? copyListing(listing) : null
}

function ownedListing(id: string): Listing {
  const listing = getListing(id)
  if (!listing) throw new ListingApiError('Listing not found.', 404)
  if (listing.seller.id !== getDevelopmentSeller().id) {
    throw new ListingApiError(
      'Only listings created by the development seller can be managed.',
      403
    )
  }
  return listing
}

export function createListing(input: unknown): Listing {
  const fields = validateListingInput(input)
  const state = store()
  state.sequence += 1
  const now = new Date().toISOString()
  const listing: Listing = {
    ...fields,
    id: `dev-${Date.now().toString(36)}-${state.sequence}`,
    seller: getDevelopmentSeller(),
    status: 'available',
    createdAt: now,
    updatedAt: now,
  }
  state.listings.set(listing.id, listing)
  return copyListing(listing)
}

export function updateListing(id: string, input: unknown): Listing {
  const existing = ownedListing(id)
  const patch = listingInputRecord(input)
  const editable = [
    'title',
    'description',
    'price',
    'currency',
    'category',
    'condition',
    'pickupArea',
    'photoUrls',
  ]
  if (Object.keys(patch).some((key) => !editable.includes(key))) {
    throw new ListingApiError(
      'Only editable listing fields may be changed. Use Mark as Sold to change status.'
    )
  }
  let condition = existing.condition as unknown
  if ('condition' in patch) condition = patch.condition
  if (condition === null) condition = undefined
  const fields = validateListingInput({
    ...existing,
    ...patch,
    condition,
  })
  const listing: Listing = {
    ...existing,
    ...fields,
    updatedAt: new Date().toISOString(),
  }
  if (!fields.condition) delete listing.condition
  store().listings.set(id, listing)
  return copyListing(listing)
}

export function deleteListing(id: string): void {
  ownedListing(id)
  store().listings.delete(id)
}

export function markListingSold(id: string): Listing {
  const listing = ownedListing(id)
  listing.status = 'sold'
  listing.updatedAt = new Date().toISOString()
  store().listings.set(id, listing)
  return copyListing(listing)
}

export function getMyListings(): Listing[] {
  return Array.from(store().listings.values())
    .filter((listing) => listing.seller.id === getDevelopmentSeller().id)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .map(copyListing)
}
