export function isWesternEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@uwo\.ca$/i.test(email.trim())
}

export function safeMarketplaceNext(value: unknown): string {
  return typeof value === 'string' &&
    /^\/(listings(\/[a-zA-Z0-9-]+(\/edit)?)?|profile\/listings)$/.test(value)
    ? value
    : '/profile/listings'
}
