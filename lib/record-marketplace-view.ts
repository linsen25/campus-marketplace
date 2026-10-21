import { marketplaceRequest } from '@/lib/listings-api'

/** One command per explicit open. Analytics never blocks or interrupts the card. */
export function recordMarketplaceView(listingId: string) {
  return recordView('/api/listings/view', { listingId })
}

export function recordShopView(shopId: string) {
  return recordView('/api/shops/view', { shopId })
}

function recordView(
  path: string,
  subject: { listingId: string } | { shopId: string }
) {
  // Never let UUID/network failures interrupt the approved browsing interaction.
  try {
    const eventId = crypto.randomUUID()
    const send = () => marketplaceRequest(path, 'POST', { ...subject, eventId })
    return send().catch(() => send().catch(() => undefined))
  } catch {
    return Promise.resolve()
  }
}
