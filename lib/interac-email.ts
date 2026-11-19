/**
 * Normalizes the contact address used for a direct Interac e-Transfer.
 * This is deliberately separate from the account email and does not assert
 * bank enrollment or ownership; the database determines verified status.
 */
export function normalizeInteracEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null
}
