export function normalizeInteracEmail(value: unknown) {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
    ? email
    : null
}
