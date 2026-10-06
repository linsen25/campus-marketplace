import { listingConditions } from '@/lib/listing-metadata'
import {
  isMarketCategory,
  isMarketPair,
  isMarketSubcategory,
} from '@/lib/market-taxonomy'
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
  const { category, subcategory } = requireListingTaxonomy(data)
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

  const expectedImageCount = requireExpectedImageCount(data.expectedImageCount)

  return {
    expectedImageCount,
    title,
    description,
    price: data.price,
    currency: 'CAD',
    category,
    subcategory,
    ...(condition ? { condition } : {}),
    pickupArea,
    photoUrls: Array.from(new Set(photoUrls)),
  }
}

export function validateListingPatch(input: unknown): Record<string, unknown> {
  const patch = listingInputRecord(input)
  const allowed = ['title', 'description', 'price', 'condition', 'pickupArea']
  if (Object.keys(patch).some((key) => !allowed.includes(key)))
    throw new ListingApiError(
      'Only title, price, description, condition, and pickup area may be changed; category and subcategory are locked. Use image actions for photos.'
    )
  return patch
}

function requireListingTaxonomy(data: Record<string, unknown>) {
  const { category, subcategory } = data
  if (!isMarketCategory(category))
    throw new ListingApiError('Choose a marketplace category.')
  if (!isMarketSubcategory(subcategory))
    throw new ListingApiError('Choose a marketplace subcategory.')
  if (!isMarketPair(category, subcategory))
    throw new ListingApiError(
      'Selected subcategory does not belong to this category.'
    )
  return { category, subcategory }
}

function requireExpectedImageCount(value: unknown): number {
  const expectedImageCount = value
  if (
    typeof expectedImageCount !== 'number' ||
    !Number.isInteger(expectedImageCount) ||
    expectedImageCount < 1 ||
    expectedImageCount > listingLimits.photos
  )
    throw new ListingApiError('Expected image count must be between 1 and 6.')
  return expectedImageCount
}
