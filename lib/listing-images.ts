export const listingImageRules = {
  maxFiles: 6,
  maxBytes: 3 * 1024 * 1024,
  mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
}

export function validateListingImage(file: {
  size: number
  type: string
}): void {
  if (!listingImageRules.mimeTypes.includes(file.type))
    throw new Error('Choose a JPEG, PNG, or WebP image.')
  if (file.size <= 0 || file.size > listingImageRules.maxBytes)
    throw new Error('Each image must be between 1 byte and 3 MB.')
}

export function hasImageSignature(bytes: Uint8Array, type: string): boolean {
  if (type === 'image/jpeg')
    return (
      bytes.length >= 3 &&
      bytes[0] === 255 &&
      bytes[1] === 216 &&
      bytes[2] === 255
    )
  if (type === 'image/png')
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value
    )
  if (type === 'image/webp')
    return (
      String.fromCharCode(...Array.from(bytes.slice(0, 4))) === 'RIFF' &&
      String.fromCharCode(...Array.from(bytes.slice(8, 12))) === 'WEBP'
    )
  return false
}
