import type { ConversationListingProvenance } from '@/types/conversation'

export const notificationCategories = [
  'message',
  'order',
  'listing',
  'system',
] as const
export type NotificationCategory = typeof notificationCategories[number]

export type NotificationItem = {
  listingProvenance?: ConversationListingProvenance
  id: string
  event_type: string
  created_at: string
  read_at: string | null
  destination: Record<string, unknown>
  original_price_cents?: number | null
  latest_price_cents?: number | null
}

const b27SystemEvents = new Set([
  'shop_trial_activated',
  'shop_membership_access_started',
  'shop_membership_access_upgraded',
  'shop_suspended',
  'shop_reopened',
  'connected_bank_payout_paid',
  'connected_bank_payout_failed',
  'connected_bank_payout_canceled',
])
const b27OrderEvents = new Set([
  'order_refund_succeeded',
  'order_refund_failed',
  'order_refund_unresolved',
  'seller_transfer_succeeded',
  'seller_transfer_failed',
  'seller_transfer_unresolved',
  'seller_transfer_reversed',
  'seller_transfer_partially_reversed',
])

export function notificationCategory(
  item: Pick<NotificationItem, 'destination' | 'event_type'>
): NotificationCategory {
  if (b27SystemEvents.has(item.event_type)) return 'system'
  if (b27OrderEvents.has(item.event_type)) return 'order'
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
