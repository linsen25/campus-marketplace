import { validateListingImage } from '@/lib/listing-images'
import { listingConditions } from '@/lib/listing-metadata'
import { validateListingInput } from '@/lib/listing-validation'
import { isMarketPair } from '@/lib/market-taxonomy'
import { parseOfferAmount } from '@/lib/offer-amount'
import type { Listing, ListingCondition } from '@/types/listing'
import type { MeetingLocation } from '@/types/meeting-location'
import { parseListingPrice } from '@/utils/parse-listing-price'

export type ListingFields = {
  title: string
  price: string
  category: string
  subcategory: string
  condition: string
  estimatedDeliveryFee: string
  preferredPaymentMode: 'external' | 'uu_pay'
  preferredFulfillment: 'DELIVERY' | 'ON_CAMPUS'
  meetingLocation: MeetingLocation | null
  description: string
}

export function initialListingFields(listing?: Listing): ListingFields {
  const estimate = listing?.estimatedDeliveryFeeCents ?? 0
  return {
    title: listing?.title ?? '',
    price: listing ? (listing.price / 100).toFixed(2) : '',
    category: listing?.category ?? '',
    subcategory: listing?.subcategory ?? '',
    condition: listing?.condition ?? '',
    estimatedDeliveryFee: `${Math.floor(estimate / 100)}.${String(
      estimate % 100
    ).padStart(2, '0')}`,
    preferredPaymentMode: listing?.preferredPaymentMode ?? 'uu_pay',
    preferredFulfillment: listing?.preferredFulfillment ?? 'ON_CAMPUS',
    meetingLocation: listing?.meetingLocation ?? null,
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
  const estimatedDeliveryFeeCents = parseOfferAmount(
    fields.estimatedDeliveryFee.trim() || '0',
    true
  )
  if (
    estimatedDeliveryFeeCents === null &&
    fields.preferredFulfillment === 'DELIVERY'
  )
    throw new Error(
      'Enter a non-negative estimated delivery fee with up to two decimal places.'
    )
  return validateListingInput({
    ...fields,
    ...(listing?.pickupArea ? { pickupArea: listing.pickupArea } : {}),
    estimatedDeliveryFeeCents: estimatedDeliveryFeeCents ?? 0,
    price: parseListingPrice(fields.price),
    currency: 'CAD',
    photoUrls: [],
    expectedImageCount:
      listing?.expectedImageCount ??
      (listing ? listing.photoUrls.length : files.length),
    condition: fields.condition as ListingCondition,
  })
}
