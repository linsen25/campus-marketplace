import { listingConditions, listingSorts } from '@/lib/listing-metadata'
import {
  ListingApiError,
  validateListingPatch,
  validateListingInput,
} from '@/lib/listing-validation'
import { isMarketFilterPair } from '@/lib/market-taxonomy'
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

const selection: string =
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
    subcategory: input.subcategory,
    condition: input.condition || null,
    pickup_area: input.pickupArea,
    expected_image_count: input.expectedImageCount,
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
  validatePlace(query.pickupArea)
  if (!isMarketFilterPair(query.category, query.subcategory))
    throw new ListingApiError('Choose a valid category/subcategory pair.')
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

  async function readListing(
    id: string,
    publicOnly = true
  ): Promise<Listing | null> {
    if (!uuid.test(id)) return null
    let request = client
      .from('listings')
      .select<string, ListingRow>(selection)

      .eq('id', id)
    if (publicOnly) request = request.filter('published_at', 'not.is', 'null')
    const { data, error } = await request.maybeSingle()
    databaseError(error)
    return data ? toListing(data) : null
  }

  async function owned(id: string) {
    const user = await requireMarketplaceUser(client)
    const listing = await readListing(id, false)
    if (!listing) throw new ListingApiError('Listing not found.', 404)
    if (listing.seller.id !== user.id)
      throw new ListingApiError('You can only manage your own listings.', 403)
    return listing
  }

  async function getListings(
    query: ListingQuery = {},
    favoriteUserId: string | undefined = undefined
  ) {
    const { page, pageSize } = validateQuery(query)
    let request = client
      .from('listings')
      .select<string, ListingRow>(
        favoriteUserId
          ? `${selection},listing_favorites!inner(user_id)`
          : selection
      )

      .filter('published_at', 'not.is', 'null')
    if (favoriteUserId)
      request = request
        .eq('listing_favorites.user_id', favoriteUserId)
        .eq('status', 'available')
    if (query.pickupArea) request = request.eq('pickup_area', query.pickupArea)
    if (query.category) request = request.eq('category', query.category)
    if (query.subcategory)
      request = request.eq('subcategory', query.subcategory)
    if (query.condition) request = request.eq('condition', query.condition)
    request = request.eq('status', query.status || 'available')
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
  }

  return {
    getListing: (id: string) => readListing(id),
    getCreationListing: owned,
    getListings,
    async getFavoriteListings(query: ListingQuery = {}) {
      const user = await requireMarketplaceUser(client)
      return getListings({ ...query, status: 'available' }, user.id)
    },
    async favoriteState(id: string) {
      if (!uuid.test(id)) throw new ListingApiError('Invalid listing ID.')
      const user = await requireMarketplaceUser(client)
      const { data, error } = await client
        .from('listing_favorites')
        .select('listing_id')
        .eq('user_id', user.id)
        .eq('listing_id', id)
        .maybeSingle()
      databaseError(error)
      return { favorited: Boolean(data) }
    },
    async setFavorite(id: string, enabled: boolean) {
      const user = await requireMarketplaceUser(client)
      if (!uuid.test(id)) throw new ListingApiError('Invalid listing ID.')
      if (!enabled) {
        const { error } = await client
          .from('listing_favorites')
          .delete()
          .eq('user_id', user.id)
          .eq('listing_id', id)
        databaseError(error)
        return { favorited: false }
      }
      const listing = await readListing(id)
      if (
        !listing ||
        listing.status !== 'available' ||
        listing.seller.id === user.id
      )
        throw new ListingApiError(
          'Only another seller?s published available listing can be favorited.'
        )
      const { error } = await client
        .from('listing_favorites')
        .insert({ user_id: user.id, listing_id: id })
      if (error?.code !== '23505') databaseError(error)
      return { favorited: true }
    },
    async finalizeListing(id: string) {
      await requireMarketplaceUser(client)
      if (!uuid.test(id)) throw new ListingApiError('Invalid listing ID.')
      const { error } = await client.rpc('marketplace_finalize_listing', {
        listing_id: id,
      })
      databaseError(error)
      const listing = await readListing(id)
      if (!listing)
        throw new ListingApiError('Unable to confirm publication.', 503)
      return listing
    },
    async abandonListing(id: string) {
      await owned(id)
      const { data: images, error: imageError } = await client
        .from('listing_images')
        .select('path')
        .eq('listing_id', id)
      databaseError(imageError)
      // Atomic predicate: a lost finalize response must never delete a published listing.
      const { data, error } = await client
        .from('listings')
        .delete()
        .eq('id', id)
        .is('published_at', null)
        .select('id')
        .maybeSingle()
      databaseError(error)
      if (!data)
        throw new ListingApiError(
          'Listing was already published; cleanup refused.',
          409
        )
      if (images?.length) {
        const { error: cleanupError } = await client.storage
          .from(listingBucket)
          .remove(images.map((image) => image.path))
        if (cleanupError)
          throw new ListingApiError(
            'Unpublished row removed; storage cleanup requires retry.',
            503
          )
      }
    },
    async getMyListings() {
      const user = await requireMarketplaceUser(client)
      const { data, error } = await client
        .from('listings')
        .select<string, ListingRow>(selection)
        .eq('seller_id', user.id)
        .filter('published_at', 'not.is', 'null')
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
        .select<string, ListingRow>(selection)
        .single()
      databaseError(error)
      return toListing(data)
    },
    async updateListing(id: string, input: UpdateListingInput) {
      const listing = await owned(id)
      if (!listing.publishedAt || listing.status !== 'available')
        throw new ListingApiError(
          'Only published available listings can be edited.'
        )
      const patch = validateListingPatch(input)
      const merged = { ...listing, ...patch, photoUrls: [] }
      if (patch.condition === null) delete merged.condition
      const validated = validateListingInput(merged)
      const { data, error } = await client
        .from('listings')
        .update({
          title: validated.title,
          description: validated.description,
          price_cents: validated.price,
          condition: validated.condition || null,
          pickup_area: validated.pickupArea,
        })
        .eq('id', id)
        .select<string, ListingRow>(selection)
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
      const listing = await owned(id)
      if (!listing.publishedAt)
        throw new ListingApiError('Publish before marking a listing sold.')
      const { data, error } = await client
        .from('listings')
        .update({ status: 'sold' })
        .eq('id', id)
        .select<string, ListingRow>(selection)
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

function validatePlace(pickupArea: unknown) {
  if (
    pickupArea !== undefined &&
    (typeof pickupArea !== 'string' ||
      !pickupArea.trim() ||
      pickupArea.length > 120)
  )
    throw new ListingApiError('Choose a valid pickup area/place.')
}
