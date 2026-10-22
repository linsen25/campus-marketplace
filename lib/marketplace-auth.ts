export function isWesternEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^\s@]+@uwo\.ca$/i.test(email.trim())
}

export function safeMarketplaceNext(value: unknown): string {
  return typeof value === 'string' &&
    /^\/(listings(\/[a-zA-Z0-9-]+(\/edit)?)?|profile\/listings|home)$/.test(
      value
    )
    ? value
    : '/home'
}

export function marketplaceAuthEntry(next: unknown): string {
  return `/listings?auth=signin&next=${encodeURIComponent(
    safeMarketplaceNext(next)
  )}`
}

export function marketplaceAuthDestination(next: unknown): string {
  const destination = safeMarketplaceNext(next)
  return destination === '/listings/new'
    ? '/home?section=create-listing'
    : destination
}
