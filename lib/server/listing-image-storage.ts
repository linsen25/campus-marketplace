import { listingImageBucket } from '@/lib/listing-media'
import type { ListingImageSource } from '@/lib/listing-media'
import type { MarketplaceClient } from '@/lib/supabase/server'

// Session-scoped Storage RLS is the final deletion guard. Never use service role
// here: a still-referenced object must remain undeletable even after a race.
export async function removeListingImageObjects(
  client: MarketplaceClient,
  images: ListingImageSource[]
) {
  const groups = new Map<string, string[]>()
  for (const image of images) {
    const bucket = listingImageBucket(image)
    groups.set(bucket, [...(groups.get(bucket) || []), image.path])
  }
  let failure: { message?: string } | null = null
  for (const [bucket, paths] of Array.from(groups)) {
    const { error } = await client.storage.from(bucket).remove(paths)
    if (error) {
      failure = error
      // eslint-disable-next-line no-console -- Exact orphan candidates, no credentials.
      console.warn('Listing image cleanup requires retry', bucket, paths)
    }
  }
  return failure
}
