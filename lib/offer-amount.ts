export const offerAmount = (cents: number) =>
  new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' })
    .format(cents / 100)
    .replace(/^\$/, 'CA$')
// Decimal text -> integer cents. No binary floating-point transaction arithmetic.
export function parseOfferAmount(value: string, allowZero = false) {
  if (!/^\d{1,14}(\.\d{1,2})?$/.test(value)) return null
  const [whole, fractional = ''] = value.split('.')
  const cents = BigInt(whole) * BigInt(100) + BigInt(fractional.padEnd(2, '0'))
  if (
    cents > BigInt(Number.MAX_SAFE_INTEGER) ||
    cents < BigInt(allowZero ? 0 : 1)
  )
    return null
  return Number(cents)
}
