import { validateListingImage } from '@/lib/listing-images'
import { listingConditions } from '@/lib/listing-metadata'
import { validateListingInput } from '@/lib/listing-validation'
import { isMarketPair, marketLocations } from '@/lib/market-taxonomy'
import type { Listing, ListingCondition } from '@/types/listing'
import { parseListingPrice } from '@/utils/parse-listing-price'

export type ListingFields = {
  title: string
  price: string
  category: string
  subcategory: string
  condition: string
  pickupArea: string
  description: string
}

export function initialListingFields(listing?: Listing): ListingFields {
  return {
    title: listing?.title ?? '',
    price: listing ? (listing.price / 100).toFixed(2) : '',
    category: listing?.category ?? '',
    subcategory: listing?.subcategory ?? '',
    condition: listing?.condition ?? '',
    pickupArea: listing?.pickupArea ?? '',
    description: listing?.description ?? '',
  }
}

export function changeBuilderCategory(
  fields: ListingFields,
  category: string
): ListingFields {
  return {
    ...fields,
    category,
    subcategory: isMarketPair(category, fields.subcategory)
      ? fields.subcategory
      : '',
  }
}

export function validateBuilder(
  fields: ListingFields,
  files: File[],
  listing?: Listing
) {
  if (!listing && (files.length < 1 || files.length > 6))
    throw new Error('Choose 1-6 photos.')
  files.forEach(validateListingImage)
  if (!listingConditions.some((item) => item.value === fields.condition))
    throw new Error('Choose a condition.')
  if (!(marketLocations as readonly string[]).includes(fields.pickupArea))
    throw new Error('Choose a place.')
  return validateListingInput({
    ...fields,
    price: parseListingPrice(fields.price),
    currency: 'CAD',
    photoUrls: [],
    expectedImageCount:
      listing?.expectedImageCount ??
      (listing ? listing.photoUrls.length : files.length),
    condition: fields.condition as ListingCondition,
  })
}
