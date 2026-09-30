/** Format non-negative integer CAD cents for marketplace display. */
export function formatListingPrice(price: number): string {
  if (!Number.isSafeInteger(price) || price < 0) {
    throw new RangeError('Listing price must be non-negative integer cents')
  }

  if (price === 0) return 'FREE'

  return `CA$${(price / 100).toFixed(price % 100 === 0 ? 0 : 2)}`
}
