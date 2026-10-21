import { listingImageBucket } from '@/lib/listing-media'
import { ListingApiError } from '@/lib/listing-validation'
import { removeListingImageObjects } from '@/lib/server/listing-image-storage'
import { databaseError } from '@/lib/server/supabase-listings-repository'
import type { MarketplaceClient } from '@/lib/supabase/server'

/** Same manifest slot + exact bytes; never overwrite an existing object. */
export async function recoverListingImage(
  client: MarketplaceClient,
  listingId: string,
  ownerId: string,
  {
    slot,
    bytes,
    contentType,
  }: { slot: number; bytes: Buffer; contentType: string }
) {
  const read = async () => {
    const { data, error } = await client
      .from('listing_images')
      .select('id,path,ready,slot,owner_id,storage_bucket')
      .eq('listing_id', listingId)
      .eq('slot', slot)
      .maybeSingle()
    databaseError(error)
    return data
  }
  let image = await read()
  if (!image) {
    const { error } = await client
      .from('listing_images')
      .insert({ listing_id: listingId, slot })
    if (error?.code !== '23505') databaseError(error)
    image = await read()
  }
  if (
    !image ||
    image.owner_id !== ownerId ||
    image.path !== `${ownerId}/${listingId}/${image.id}`
  )
    throw new ListingApiError('Unable to confirm image reservation.', 409)
  try {
    const bucket = client.storage.from(listingImageBucket(image))
    const sameBytes = async () => {
      const { data, error } = await bucket.download(image!.path)
      if (error) {
        if (String(error.statusCode) === '404' || error.status === 404)
          return false
        throw new ListingApiError(
          'Unable to confirm stored image. Please retry.',
          503
        )
      }
      if (!data || !Buffer.from(await data.arrayBuffer()).equals(bytes))
        throw new ListingApiError(
          'The reserved image does not match this photo. No image was replaced.',
          409
        )
      return true
    }
    const exists = await sameBytes()
    if (!exists) {
      if (image.ready)
        throw new ListingApiError(
          'A ready image is missing. Publication requires review.',
          409
        )
      const { error } = await bucket.upload(image.path, bytes, {
        contentType,
        upsert: false,
        cacheControl: '3600',
      })
      if (error) {
        if (
          ![error.status, Number(error.statusCode)].includes(409) ||
          !(await sameBytes())
        )
          throw new ListingApiError(
            'Image upload is unconfirmed. Retry this same publication.',
            503
          )
      }
    }
    const current = await read()
    if (!current || current.id !== image.id) {
      throw new ListingApiError(
        'Image reservation changed. Retry reconciliation.',
        409
      )
    }
    if (!current.ready) {
      const { data, error } = await client
        .from('listing_images')
        .update({ ready: true })
        .eq('id', image.id)
        .select('id')
        .maybeSingle()
      databaseError(error)
      if (!data)
        throw new ListingApiError('Image reservation was removed.', 409)
    }
  } finally {
    // A request may finish uploading after Discard removed its reservation.
    // Recheck before cleanup; session Storage RLS independently blocks deleting
    // any object still referenced by a concurrent successful publication.
    try {
      if (!(await read())) await removeListingImageObjects(client, [image])
    } catch {
      // eslint-disable-next-line no-console -- Exact reconciliation key only.
      console.warn(
        'Listing upload reconciliation requires retry',
        listingId,
        image.id,
        image.storage_bucket,
        image.path
      )
    }
  }
}
