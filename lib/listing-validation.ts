import { listingCategories, listingConditions } from '@/lib/listing-metadata'
import type { CreateListingInput } from '@/types/listing'

export const listingLimits = {
  title: 120,
  description: 5000,
  pickupArea: 120,
  photos: 6,
}

export class ListingApiError extends Error {
  constructor(message: string, public status: number = 400) {
    super(message)
    this.name = 'ListingApiError'
  }
}

export function listingInputRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new ListingApiError('Provide valid listing fields.')
  }
  return input as Record<string, unknown>
}

export function validateListingInput(input: unknown): CreateListingInput {
  const data = listingInputRecord(input)
  const title = typeof data.title === 'string' ? data.title.trim() : ''
  const description =
    typeof data.description === 'string' ? data.description.trim() : ''
  const pickupArea =
    typeof data.pickupArea === 'string' ? data.pickupArea.trim() : ''
  if (!title || title.length > listingLimits.title) {
    throw new ListingApiError(
      `Title is required and must be at most ${listingLimits.title} characters.`
    )
  }
  if (
    typeof data.description !== 'string' ||
    description.length > listingLimits.description
  ) {
    throw new ListingApiError(
      `Description must be at most ${listingLimits.description} characters.`
    )
  }
  if (!pickupArea || pickupArea.length > listingLimits.pickupArea) {
    throw new ListingApiError(
      `Pickup area is required and must be at most ${listingLimits.pickupArea} characters.`
    )
  }
  if (
    typeof data.price !== 'number' ||
    !Number.isSafeInteger(data.price) ||
    data.price < 0
  ) {
    throw new ListingApiError('Price must be non-negative integer cents.')
  }
  if (data.currency !== 'CAD')
    throw new ListingApiError('Currency must be CAD.')
  const category = listingCategories.find(
    (item) => item.value === data.category
  )?.value
  if (!category) throw new ListingApiError('Choose a marketplace category.')
  const condition = listingConditions.find(
    (item) => item.value === data.condition
  )?.value
  if (data.condition !== undefined && !condition) {
    throw new ListingApiError(
      'Choose a valid condition or leave it unspecified.'
    )
  }
  if (
    !Array.isArray(data.photoUrls) ||
    data.photoUrls.length > listingLimits.photos
  ) {
    throw new ListingApiError(`Use at most ${listingLimits.photos} photo URLs.`)
  }
  const photoUrls = data.photoUrls.map((photo: unknown) => {
    if (typeof photo !== 'string' || photo.length > 2048)
      throw new ListingApiError('Invalid image reference.')
    return photo
  })

  return {
    title,
    description,
    price: data.price,
    currency: 'CAD',
    category,
    ...(condition ? { condition } : {}),
    pickupArea,
    photoUrls: Array.from(new Set(photoUrls)),
  }
}
