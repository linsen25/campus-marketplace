export const notificationCategories = [
  'message',
  'order',
  'listing',
  'system',
] as const
export type NotificationCategory = typeof notificationCategories[number]

export type NotificationItem = {
  id: string
  event_type: string
  created_at: string
  read_at: string | null
  destination: Record<string, unknown>
  original_price_cents?: number | null
  latest_price_cents?: number | null
}
export function notificationCategory(
  item: Pick<NotificationItem, 'destination' | 'event_type'>
): NotificationCategory {
  if (item.event_type === 'new_message') return 'message'
  if (
    item.event_type === 'price_drop' ||
    item.destination.section === 'listing'
  )
    return 'listing'
  if (
    /^(incoming_|offer_|agreement_|payment_|seller_delivery_|handoff_|protection_|order_|cancellation_|courier_|buyer_confirm_|meetup_|reservation_|delivery_|payout_)/.test(
      item.event_type
    ) ||
    item.destination.section === 'orders'
  )
    return 'order'
  if (item.destination.section === 'messages') return 'message'
  return 'system'
}
export function notificationTime(value: string, now = Date.now()) {
  const seconds = Math.max(0, Math.floor((now - Date.parse(value)) / 1000))
  if (seconds < 60) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}
