import { validateListingImage } from './listing-images'

export const messageImageLimit = 4

/** Validate the entire selection before allocating URLs or changing the draft. */
export function validateMessageImages(
  selected: ReadonlyArray<Pick<File, 'size' | 'type'>>,
  existingCount: number
): void {
  if (existingCount + selected.length > messageImageLimit)
    throw new Error('Choose at most 4 photos.')
  selected.forEach(validateListingImage)
}
