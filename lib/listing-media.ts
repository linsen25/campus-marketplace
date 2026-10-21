import { ListingApiError } from '@/lib/listing-validation'

export const legacyListingBucket = 'listing-images'
export const privateListingBucket = 'listing-images-private'
export type ListingImageSource = {
  id?: string
  path: string
  storage_bucket?: string
}
export function listingImageBucket(image: ListingImageSource): string {
  if (
    ![legacyListingBucket, privateListingBucket].includes(
      image.storage_bucket || ''
    )
  )
    throw new ListingApiError('Invalid image source.', 503)
  return image.storage_bucket!
}
export function listingImageUrl(
  image: ListingImageSource,
  legacyUrl: (path: string) => string
): string {
  // Old fixture projections may omit the additive column. Real DB rows cannot.
  if (!image.storage_bucket || image.storage_bucket === legacyListingBucket)
    return legacyUrl(image.path)
  listingImageBucket(image)
  if (
    !image.id ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      image.id
    )
  )
    throw new ListingApiError('Invalid image identity.', 503)
  return `/api/listing-media/${image.id}`
}
