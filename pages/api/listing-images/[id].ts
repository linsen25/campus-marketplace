import type { NextApiRequest, NextApiResponse } from 'next'

import {
  hasImageSignature,
  listingImageRules,
  validateListingImage,
} from '@/lib/listing-images'
import { listingImageBucket, listingImageUrl } from '@/lib/listing-media'
import { ListingApiError } from '@/lib/listing-validation'
import { recoverListingImage } from '@/lib/server/listing-image-recovery'
import { removeListingImageObjects } from '@/lib/server/listing-image-storage'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import {
  createSupabaseListingsRepository,
  databaseError,
  listingBucket,
} from '@/lib/server/supabase-listings-repository'
import type { MarketplaceClient } from '@/lib/supabase/server'
import { createMarketplaceClient } from '@/lib/supabase/server'

function checkImage(file: { type: string; size: number }): void {
  try {
    validateListingImage(file)
  } catch (error) {
    throw new ListingApiError(
      error instanceof Error ? error.message : 'Invalid image.'
    )
  }
}

function recoverySlot(value: unknown, count: number) {
  if (
    typeof value !== 'string' ||
    !/^[1-6]$/.test(value) ||
    Number(value) > count
  )
    throw new ListingApiError(
      'Choose an image slot within the creation manifest.'
    )
  return Number(value)
}

async function readImage(req: NextApiRequest): Promise<Buffer> {
  const type = String(req.headers['content-type'] || '')
  checkImage({
    type,
    size: Number(req.headers['content-length'] || 1),
  })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > listingImageRules.maxBytes)
      throw new ListingApiError('Each image must be at most 3 MB.', 413)
    chunks.push(buffer)
  }
  checkImage({ type, size })
  const image = Buffer.concat(chunks)
  if (!hasImageSignature(image, type))
    throw new ListingApiError(
      'The file contents do not match a supported image.'
    )
  return image
}

async function reserveImage(
  client: MarketplaceClient,
  id: string,
  count: number
) {
  // Unique (listing_id,slot) keeps concurrent uploads inside the creation manifest.
  for (let slot = 1; slot <= count; slot += 1) {
    const { data, error } = await client
      .from('listing_images')
      .insert({ listing_id: id, slot })
      .select('id,path,storage_bucket')
      .single()
    if (!error) return data
    if (error.code !== '23505') databaseError(error)
  }
  throw new ListingApiError('All expected image slots are occupied.')
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!['POST', 'DELETE'].includes(req.method || '')) {
    res.setHeader('Allow', 'POST, DELETE')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    requireSameOriginWrite(req)
    const client = createMarketplaceClient({ req, res })
    const user = await requireMarketplaceUser(client)
    const id = String(req.query.id)
    const repository = createSupabaseListingsRepository({ req, res })
    const listing = await repository.getCreationListing(id)
    if (listing.publishedAt || listing.status !== 'available')
      throw new ListingApiError('Published listing images are immutable.')
    if (!listing) throw new ListingApiError('Listing not found.', 404)
    if (listing.seller.id !== user.id)
      throw new ListingApiError(
        'You can only change your own listing images.',
        403
      )
    if (req.method === 'DELETE') {
      const { data: images, error } = await client
        .from('listing_images')
        .select('id,path,storage_bucket')
        .eq('listing_id', id)
      databaseError(error)
      const image = images?.find(
        (item) =>
          listingImageUrl(
            item,
            (path) =>
              client.storage.from(listingBucket).getPublicUrl(path).data
                .publicUrl
          ) === req.query.url
      )
      if (!image) throw new ListingApiError('Image not found.', 404)
      await removeImageReservation(client, image)
    } else {
      const bytes = await readImage(req)
      if (req.query.slot !== undefined) {
        await recoverListingImage(client, id, user.id, {
          slot: recoverySlot(req.query.slot, listing.expectedImageCount ?? 0),
          bytes,
          contentType: String(req.headers['content-type']),
        })
        return res.status(200).json(await repository.getCreationListing(id))
      }
      const image = await reserveImage(
        client,
        id,
        listing.expectedImageCount ?? 0
      )
      if (!image)
        throw new ListingApiError('Unable to reserve an image slot.', 503)
      try {
        const { error } = await client.storage
          .from(listingImageBucket(image))
          .upload(image.path, bytes, {
            contentType: String(req.headers['content-type']),
            upsert: false,
            cacheControl: '3600',
          })
        if (error)
          throw new ListingApiError('Image upload failed. Please retry.', 503)
        const { data: attached, error: rowError } = await client
          .from('listing_images')
          .update({ ready: true })
          .eq('id', image.id)
          .select('id')
          .maybeSingle()
        databaseError(rowError)
        if (!attached)
          throw new ListingApiError('Image reservation was removed.', 409)
      } catch (error) {
        await cleanupFailedUpload(client, id, image)
        throw error
      }
    }
    return res.status(200).json(await repository.getCreationListing(id))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to change listing images.',
      })
  }
}
export const config = { api: { bodyParser: false } }

export async function removeImageReservation(
  client: MarketplaceClient,
  image: { id: string; path: string; storage_bucket: string }
): Promise<void> {
  const { data, error } = await client
    .from('listing_images')
    .delete()
    .eq('id', image.id)
    .select('id')
    .maybeSingle()
  databaseError(error)
  if (!data)
    throw new ListingApiError('Image reservation was not removed.', 409)
  const storageError = await removeListingImageObjects(client, [image])
  if (storageError)
    throw new ListingApiError(
      'Image metadata removed; orphan object cleanup requires retry.',
      503
    )
}

async function cleanupFailedUpload(
  client: MarketplaceClient,
  listingId: string,
  image: { id: string; path: string; storage_bucket: string }
) {
  try {
    await removeImageReservation(client, image)
  } catch {
    try {
      // A late upload can outlive Discard. Confirm absence before object cleanup;
      // session Storage RLS independently protects any current reference.
      const check = await client
        .from('listing_images')
        .select('id')
        .eq('id', image.id)
        .maybeSingle()
      if (!check.error && !check.data)
        await removeListingImageObjects(client, [image])
    } catch {
      // Retain original upload error and the exact reconciliation key below.
    }
    // eslint-disable-next-line no-console -- Candidate key only, no credentials.
    console.warn(
      'Listing upload cleanup requires reconciliation',
      listingId,
      image.id,
      image.storage_bucket,
      image.path
    )
  }
}
