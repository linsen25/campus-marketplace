import type { NextApiRequest, NextApiResponse } from 'next'

import {
  hasImageSignature,
  listingImageRules,
  validateListingImage,
} from '@/lib/listing-images'
import { ListingApiError } from '@/lib/listing-validation'
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
      .select('id,path')
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
        .select('id,path')
        .eq('listing_id', id)
      databaseError(error)
      const image = images?.find(
        (item) =>
          client.storage.from(listingBucket).getPublicUrl(item.path).data
            .publicUrl === req.query.url
      )
      if (!image) throw new ListingApiError('Image not found.', 404)
      await removeImageReservation(client, image)
    } else {
      const bytes = await readImage(req)
      const image = await reserveImage(
        client,
        id,
        listing.expectedImageCount ?? 0
      )
      if (!image)
        throw new ListingApiError('Unable to reserve an image slot.', 503)
      try {
        const { error } = await client.storage
          .from(listingBucket)
          .upload(image.path, bytes, {
            contentType: String(req.headers['content-type']),
            upsert: false,
            cacheControl: '3600',
          })
        if (error)
          throw new ListingApiError('Image upload failed. Please retry.', 503)
        const { error: rowError } = await client
          .from('listing_images')
          .update({ ready: true })
          .eq('id', image.id)
        databaseError(rowError)
      } catch (error) {
        // If metadata deletion is rejected, do not attempt object deletion.
        try {
          await removeImageReservation(client, image)
        } catch {
          /* Best-effort orphan cleanup; retain the upload error. */
        }
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
  image: { id: string; path: string }
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
  const { error: storageError } = await client.storage
    .from(listingBucket)
    .remove([image.path])
  if (storageError)
    throw new ListingApiError(
      'Image metadata removed; orphan object cleanup requires retry.',
      503
    )
}
