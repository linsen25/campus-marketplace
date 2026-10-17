import { marketplaceRequest } from '@/lib/listings-api'

/** One command per explicit open. Analytics never blocks or interrupts the card. */
export function recordMarketplaceView(listingId: string) {
  const eventId = crypto.randomUUID()
  const send = () =>
    marketplaceRequest('/api/listings/view', 'POST', { listingId, eventId })
  return send().catch(() => send().catch(() => undefined))
}
