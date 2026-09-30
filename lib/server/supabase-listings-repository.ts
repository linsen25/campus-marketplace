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
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import type { ListingRow } from '@/lib/supabase/listing-mapper'
import { mapListing } from '@/lib/supabase/listing-mapper'
import type { MarketplaceContext } from '@/lib/supabase/server'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type {
  CreateListingInput,
  Listing,
  ListingQuery,
  UpdateListingInput,
} from '@/types/listing'

const selection =
  '*,profiles!listings_seller_id_fkey(id,display_name),listing_images(path,slot,ready)'
export const listingBucket = 'listing-images'
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function databaseError(
  error: { code?: string; message?: string } | null
): void {
  if (!error) return
  if (error.code === '42501')
    throw new ListingApiError(
      'You do not have permission to change this listing.',
      403
    )
  if (['23514', '22001', '22P02', 'P0001'].includes(error.code || ''))
    throw new ListingApiError(
      'The listing data did not pass database validation.'
    )
  throw new ListingApiError(
    'The marketplace database is unavailable or has not been set up.',
    503
  )
}

function fields(input: CreateListingInput) {
  return {
    title: input.title,
    description: input.description,
    price_cents: input.price,
    currency: input.currency,
    category: input.category,
    condition: input.condition || null,
    pickup_area: input.pickupArea,
  }
}

function validateQuery(query: ListingQuery) {
  const { page = 1, pageSize = 20 } = query
  if (
    !Number.isSafeInteger(page) ||
    page < 1 ||
    !Number.isSafeInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > 100
  )
    throw new ListingApiError(
      'Use a positive page and a page size between 1 and 100.'
    )
  for (const price of [query.minPrice, query.maxPrice]) {
    if (price !== undefined && (!Number.isSafeInteger(price) || price < 0))
      throw new ListingApiError(
        'Price bounds must be non-negative integer cents.'
      )
  }
  if (
    query.minPrice !== undefined &&
    query.maxPrice !== undefined &&
    query.minPrice > query.maxPrice
  )
    throw new ListingApiError('Minimum price must not exceed maximum price.')
  if (
    query.category &&
    !listingCategories.some((item) => item.value === query.category)
  )
    throw new ListingApiError('Invalid category.')
  if (
    query.condition &&
    !listingConditions.some((item) => item.value === query.condition)
  )
    throw new ListingApiError('Invalid condition.')
  if (query.sort && !listingSorts.some((item) => item.value === query.sort))
    throw new ListingApiError('Invalid sort.')
  if (![undefined, 'available', 'sold'].includes(query.status))
    throw new ListingApiError('Invalid status.')
  return { page, pageSize }
}

export function createSupabaseListingsRepository(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  const toListing = (row: unknown) =>
    mapListing(
      row as ListingRow,
      (path) =>
        client.storage.from(listingBucket).getPublicUrl(path).data.publicUrl
    )

  async function getListing(id: string): Promise<Listing | null> {
    if (!uuid.test(id)) return null
    const { data, error } = await client
      .from('listings')
      .select(selection)
      .eq('id', id)
      .maybeSingle()
    databaseError(error)
    return data ? toListing(data) : null
  }

  async function owned(id: string) {
    const user = await requireMarketplaceUser(client)
    const listing = await getListing(id)
    if (!listing) throw new ListingApiError('Listing not found.', 404)
    if (listing.seller.id !== user.id)
      throw new ListingApiError('You can only manage your own listings.', 403)
    return listing
  }

  return {
    getListing,
    async getListings(query: ListingQuery = {}) {
      const { page, pageSize } = validateQuery(query)
      let request = client.from('listings').select(selection)
      if (query.category) request = request.eq('category', query.category)
      if (query.condition) request = request.eq('condition', query.condition)
      if (query.status) request = request.eq('status', query.status)
      if (query.minPrice !== undefined)
        request = request.gte('price_cents', query.minPrice)
      if (query.maxPrice !== undefined)
        request = request.lte('price_cents', query.maxPrice)
      if (query.search?.trim())
        request = request.ilike(
          'search_text',
          `%${query.search
            .trim()
            .slice(0, 200)
            .replace(/[\\%_]/g, '\\$&')}%`
        )
      if (query.sort === 'price-low' || query.sort === 'price-high')
        request = request.order('price_cents', {
          ascending: query.sort === 'price-low',
        })
      const { data, error } = await request
        .order('created_at', { ascending: false })
        .order('id')
        .range((page - 1) * pageSize, page * pageSize - 1)
      databaseError(error)
      return (data || []).map(toListing)
    },
    async getMyListings() {
      const user = await requireMarketplaceUser(client)
      const { data, error } = await client
        .from('listings')
        .select(selection)
        .eq('seller_id', user.id)
        .order('created_at', { ascending: false })
      databaseError(error)
      return (data || []).map(toListing)
    },
    async createListing(input: CreateListingInput) {
      await requireMarketplaceUser(client)
      const validated = validateListingInput(input)
      if (validated.photoUrls.length)
        throw new ListingApiError('Upload images after creating the listing.')
      const { data, error } = await client
        .from('listings')
        .insert(fields(validated))
        .select(selection)
        .single()
      databaseError(error)
      return toListing(data)
    },
    async updateListing(id: string, input: UpdateListingInput) {
      const listing = await owned(id)
      const patch = listingInputRecord(input)
      const allowed = [
        'title',
        'description',
        'price',
        'currency',
        'category',
        'condition',
        'pickupArea',
      ]
      if (Object.keys(patch).some((key) => !allowed.includes(key)))
        throw new ListingApiError(
          'Only editable fields may be changed; use image actions for photos.'
        )
      const merged = { ...listing, ...patch, photoUrls: [] }
      if (patch.condition === null) delete merged.condition
      const validated = validateListingInput(merged)
      const { data, error } = await client
        .from('listings')
        .update(fields(validated))
        .eq('id', id)
        .select(selection)
        .maybeSingle()
      databaseError(error)
      if (!data)
        throw new ListingApiError(
          'Listing not found or no longer owned by you.',
          404
        )
      return toListing(data)
    },
    async markListingSold(id: string) {
      await owned(id)
      const { data, error } = await client
        .from('listings')
        .update({ status: 'sold' })
        .eq('id', id)
        .select(selection)
        .maybeSingle()
      databaseError(error)
      if (!data) throw new ListingApiError('Listing not found.', 404)
      return toListing(data)
    },
    async deleteListing(id: string) {
      await owned(id)
      const { data: images, error: imageError } = await client
        .from('listing_images')
        .select('path')
        .eq('listing_id', id)
      databaseError(imageError)
      // Delete DB state first. Storage ownership is encoded in the path and remains valid.
      const { data, error } = await client
        .from('listings')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle()
      databaseError(error)
      if (!data) throw new ListingApiError('Listing not found.', 404)
      if (images?.length) {
        const { error: cleanupError } = await client.storage
          .from(listingBucket)
          .remove(images.map((image) => image.path))
        if (cleanupError)
          // eslint-disable-next-line no-console -- Identify failed storage cleanup for operators.
          console.warn(
            'Listing deleted; storage cleanup requires retry for listing',
            id
          )
      }
    },
  }
}
