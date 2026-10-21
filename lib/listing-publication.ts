import { validateListingImage } from '@/lib/listing-images'
import { validateListingInput } from '@/lib/listing-validation'
import {
  abandonListing,
  createListing,
  createShopListing,
  finalizeListing,
  getCreationListing,
  uploadListingImage,
} from '@/lib/listings-api'
import type { CreateListingInput, Listing } from '@/types/listing'

const defaultOperations = {
  createListing,
  uploadListingImage,
  finalizeListing,
  getCreationListing,
  abandonListing,
}

type PublicationOperations = typeof defaultOperations
/** Same upload/finalize pipeline; only the trusted creation command differs. */
export function shopPublicationOperations(
  actionId: string
): PublicationOperations {
  return {
    ...defaultOperations,
    createListing: (input) => createShopListing(input, actionId),
  }
}
export type PublicationResult =
  | {
      state: 'unknown' | 'unpublished'
      listingId: string
      retryable: true
      error: string
    }
  | { state: 'published'; listingId: string; listing: Listing }

function published(listing: Listing): PublicationResult {
  return { state: 'published', listingId: listing.id, listing }
}

function failureMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : 'Publication needs reconciliation.'
}

/** An uncertain response never implies failure or authorizes abandonment. */
export async function reconcileListingPublication(
  listingId: string,
  operations: PublicationOperations = defaultOperations,
  error: unknown = new Error('Publication needs reconciliation.')
): Promise<PublicationResult> {
  try {
    const listing = await operations.getCreationListing(listingId)
    if (listing.id !== listingId || typeof listing.publishedAt === 'undefined')
      throw new Error('Publication response could not be verified.')
    if (typeof listing.publishedAt === 'string' && listing.publishedAt)
      return published(listing)
    if (listing.publishedAt !== null)
      throw new Error('Publication response could not be verified.')
    return {
      state: 'unpublished',
      listingId,
      retryable: true,
      error: failureMessage(error),
    }
  } catch {
    return {
      state: 'unknown',
      listingId,
      retryable: true,
      error: 'Publication state is unknown. Retry using this same listing ID.',
    }
  }
}

/** Retry/finalize the SAME listing; this function never creates or abandons one. */
export async function continueListingPublication(
  listingId: string,
  operations: PublicationOperations = defaultOperations,
  files: File[] | undefined = undefined
): Promise<PublicationResult> {
  if (files) {
    const state = await reconcileListingPublication(listingId, operations)
    if (state.state !== 'unpublished') return state
    try {
      const listing = await operations.getCreationListing(listingId)
      if (
        listing.id !== listingId ||
        listing.publishedAt !== null ||
        listing.expectedImageCount !== files.length
      )
        return reconcileListingPublication(listingId, operations)
      files.forEach(validateListingImage)
      for (let index = 0; index < files.length; index += 1)
        await operations.uploadListingImage(listingId, files[index], index + 1)
    } catch (error) {
      return reconcileListingPublication(listingId, operations, error)
    }
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const listing = await operations.finalizeListing(listingId)
      if (listing.id !== listingId || !listing.publishedAt)
        throw new Error('Publication response could not be verified.')
      return published(listing)
    } catch (error) {
      if (attempt === 1)
        return reconcileListingPublication(listingId, operations, error)
    }
  }
  return reconcileListingPublication(listingId, operations)
}

/** Keeps caller-owned form/files intact. Pending results must resume by listingId. */
export async function createPublishedListing(
  input: CreateListingInput,
  files: File[],
  operations: PublicationOperations = defaultOperations
): Promise<PublicationResult> {
  const validated = validateListingInput({
    ...input,
    photoUrls: [],
    expectedImageCount: files.length,
  })
  files.forEach(validateListingImage)
  const listing = await operations.createListing(validated)
  if (listing.publishedAt) return published(listing)
  try {
    for (let index = 0; index < files.length; index += 1)
      await operations.uploadListingImage(listing.id, files[index], index + 1)
  } catch (error) {
    return reconcileListingPublication(listing.id, operations, error)
  }
  return continueListingPublication(listing.id, operations)
}
