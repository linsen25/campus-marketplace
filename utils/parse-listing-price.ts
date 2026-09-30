/** Convert decimal CAD text into integer cents without decimal multiplication. */
export function parseListingPrice(value: string): number {
  const text = value.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) {
    throw new Error(
      'Enter a price of 0 or more with at most two decimal places.'
    )
  }
  const [dollars, fraction = ''] = text.split('.')
  const cents = Number(`${dollars}${fraction.padEnd(2, '0')}`)
  if (!Number.isSafeInteger(cents))
    throw new Error('The price entered is too large.')
  return cents
}
