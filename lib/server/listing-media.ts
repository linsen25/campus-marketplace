import { hasImageSignature, listingImageRules } from '@/lib/listing-images'
import {
  legacyListingBucket,
  listingImageBucket,
  privateListingBucket,
} from '@/lib/listing-media'
import { ListingApiError } from '@/lib/listing-validation'
import { createChatStorage } from '@/lib/server/chat-image-storage'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import type { MarketplaceClient } from '@/lib/supabase/server'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const missing = () => new ListingApiError('Image not found.', 404)
async function download(bucket: string, path: string) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 30000)
  timer.unref()
  try {
    return await createChatStorage(controller.signal)
      .storage.from(bucket)
      .download(path)
  } finally {
    clearTimeout(timer)
  }
}

type MediaRow = {
  id: string
  listing_id: string
  owner_id: string
  path: string
  storage_bucket: string
  ready: boolean
  listings: {
    id: string
    seller_id: string
    published_at: string | null
    status: string
    listing_channel: string
  } | null
}
function validManifest(image: MediaRow, shopPublic = false) {
  const listing = image.listings
  return Boolean(
    listing &&
      image.ready &&
      (image.storage_bucket === privateListingBucket ||
        (shopPublic && image.storage_bucket === legacyListingBucket)) &&
      listing.id === image.listing_id &&
      listing.seller_id === image.owner_id &&
      image.path === `${image.owner_id}/${image.listing_id}/${image.id}`
  )
}
function publiclyReadable(image: MediaRow) {
  const listing = image.listings
  return Boolean(
    listing?.published_at &&
      listing.status === 'available' &&
      listing.listing_channel === 'resale'
  )
}
function sameManifest(a: MediaRow, b: MediaRow) {
  return (
    a.id === b.id &&
    a.listing_id === b.listing_id &&
    a.owner_id === b.owner_id &&
    a.path === b.path &&
    a.storage_bucket === b.storage_bucket
  )
}
function readableAfterDownload(
  current: MediaRow | null,
  previous: MediaRow,
  shopPublic: boolean,
  ownerId: string | null
) {
  return (
    current &&
    validManifest(current, shopPublic) &&
    sameManifest(previous, current) &&
    (ownerId === current.owner_id || shopPublic || publiclyReadable(current))
  )
}

// RLS-scoped metadata first; privileged Storage capability only after explicit
// authorization. No caller-supplied bucket/path, signing or redirects.
export async function readListingMedia(
  client: MarketplaceClient,
  imageId: string,
  fetchBytes = download,
  resolveShopImage = async (id: string): Promise<MediaRow | null> => {
    const { data, error } = await createChatStorage().rpc(
      'marketplace_public_shop_image',
      { p_image_id: id }
    )
    if (error) throw new ListingApiError('Image unavailable.', 503)
    return data as MediaRow | null
  }
) {
  if (!uuid.test(imageId)) throw missing()
  const read = async () => {
    const { data, error } = await client
      .from('listing_images')
      .select(
        'id,listing_id,owner_id,path,storage_bucket,ready,listings!inner(id,seller_id,published_at,status,listing_channel)'
      )
      .eq('id', imageId)
      .maybeSingle()
    if (error) throw new ListingApiError('Image unavailable.', 503)
    return data as unknown as MediaRow | null
  }
  let image = await read()
  let shopPublic = false
  if (!image || image.listings?.listing_channel === 'shop') {
    const resolved = await resolveShopImage(imageId)
    if (resolved) {
      image = resolved
      shopPublic = true
    }
  }
  if (!image || image.id !== imageId || !validManifest(image, shopPublic))
    throw missing()
  const publicRead = shopPublic || publiclyReadable(image)
  let ownerId: string | null = null
  if (!publicRead) {
    try {
      ownerId = (await requireMarketplaceUser(client)).id
    } catch {
      throw missing()
    }
    if (ownerId !== image.owner_id) throw missing()
  }
  const { data, error } = await fetchBytes(
    listingImageBucket(image),
    image.path
  )
  if (error || !data) throw missing()
  if (
    !listingImageRules.mimeTypes.includes(data.type) ||
    data.size < 1 ||
    data.size > listingImageRules.maxBytes
  )
    throw new ListingApiError('Image unavailable.', 503)
  const body = Buffer.from(await data.arrayBuffer())
  if (!hasImageSignature(body, data.type))
    throw new ListingApiError('Image unavailable.', 503)
  // A delete, detach, Sold or visibility transition during download must not
  // accidentally deliver bytes using the earlier public decision.
  const current = shopPublic ? await resolveShopImage(imageId) : await read()
  if (!readableAfterDownload(current, image, shopPublic, ownerId))
    throw missing()
  return { body, type: data.type }
}
