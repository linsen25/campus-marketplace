import { ListingApiError } from '@/lib/listing-validation'
import type { ShopExpenseFields } from '@/types/shop-costs'

export function costInputText(cents: number) {
  const value = BigInt(cents)
  return `${value / BigInt(100)}.${String(value % BigInt(100)).padStart(
    2,
    '0'
  )}`
}
export function privateCostMoney(cents: number | null) {
  if (cents === null) return 'Unknown'
  const text = costInputText(cents)
  const [whole, fraction] = text.split('.')
  return `CA$${BigInt(whole).toLocaleString('en-CA')}.${fraction}`
}
export function shopBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now)
}
export function validExpenseDate(value: unknown, today = shopBusinessDate()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return false
  const date = new Date(`${value}T00:00:00Z`)
  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value &&
    value >= '0001-01-01' &&
    value <= today
  )
}
export function costAmount(value: unknown, nullable = false): number | null {
  if (nullable && value === null) return null
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (nullable ? 0 : 1)
  )
    throw new ListingApiError('Enter a valid CAD amount.')
  return value
}
export function costRevision(value: unknown, initial = false): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < (initial ? 0 : 1)
  )
    throw new ListingApiError('A valid record version is required.')
  return value
}
export function costFields(input: unknown, keys: string[]) {
  if (
    !input ||
    typeof input !== 'object' ||
    Array.isArray(input) ||
    Object.keys(input).sort().join(',') !== [...keys].sort().join(',')
  )
    throw new ListingApiError(
      'Provide only the required cost or expense fields.'
    )
  return input as Record<string, unknown>
}
export function expenseFields(
  input: Record<string, unknown>
): ShopExpenseFields {
  if (
    input.currency !== 'CAD' ||
    typeof input.kind !== 'string' ||
    !['Packaging', 'Marketing', 'Other'].includes(String(input.kind)) ||
    typeof input.description !== 'string' ||
    input.description.length > 500 ||
    !validExpenseDate(input.on)
  )
    throw new ListingApiError(
      'Check the expense category, date and description.'
    )
  return {
    amountCents: costAmount(input.amountCents)!,
    currency: 'CAD',
    on: input.on as string,
    kind: input.kind as ShopExpenseFields['kind'],
    description: input.description,
  }
}
