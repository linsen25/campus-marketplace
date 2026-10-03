export const usernameInvalidMessage =
  'Use 3–20 letters, numbers, or underscores.'
export const usernameTakenMessage = 'That username is already taken.'
export const usernameReservedMessage = 'That username is reserved.'
export const reservedUsernames = [
  'admin',
  'administrator',
  'moderator',
  'support',
  'system',
  'staff',
  'official',
  'western',
  'uwo',
  'campusmarketplace',
  'campus_marketplace',
]
export function reservedUsername(value: string) {
  return reservedUsernames.includes(value.toLowerCase())
}
export function validUsername(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_]{3,20}$/.test(value)
}
