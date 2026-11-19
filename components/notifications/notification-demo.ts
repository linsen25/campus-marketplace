import { notificationCategory } from '@/lib/notification-category'
import type { NotificationItem } from '@/lib/notification-category'

import type { Feed } from './notification-state'

const targetUserId = process.env.NEXT_PUBLIC_NOTIFICATION_DEMO_USER_ID || ''

/**
 * Local-only UI fixtures. Enabling this requires both an explicit flag and a
 * server-confirmed session id; a display name can never activate the demo.
 */
export function notificationDemoEnabledFor(userId: string | undefined) {
  return (
    process.env.NODE_ENV === 'development' &&
    process.env.NEXT_PUBLIC_NOTIFICATION_DEMO === 'true' &&
    Boolean(targetUserId) &&
    userId === targetUserId
  )
}

const minutesAgo = (minutes: number) =>
  new Date(Date.now() - minutes * 60_000).toISOString()

const fixture = (
  id: string,
  eventType: string,
  minutes: number,
  read: boolean,
  destination: Record<string, unknown> = { section: 'notifications-demo' }
): NotificationItem => ({
  id,
  event_type: eventType,
  created_at: minutesAgo(minutes),
  read_at: read ? minutesAgo(Math.max(1, minutes - 1)) : null,
  // Demo entries intentionally have no navigable business destination.
  destination,
})

export function createNotificationDemoFeed(): Feed {
  const notifications = [
    fixture('d1000000-0000-4000-8000-000000000001', 'new_message', 2, false),
    fixture('d1000000-0000-4000-8000-000000000002', 'new_message', 12, false),
    fixture('d1000000-0000-4000-8000-000000000003', 'new_message', 38, true),
    fixture('d1000000-0000-4000-8000-000000000004', 'new_message', 75, false),
    fixture('d1000000-0000-4000-8000-000000000005', 'new_message', 180, true),
    fixture('d1000000-0000-4000-8000-000000000006', 'new_message', 420, false),
    fixture('d2000000-0000-4000-8000-000000000001', 'order_created', 25, false),
    fixture(
      'd2000000-0000-4000-8000-000000000002',
      'order_payment_received',
      95,
      true
    ),
    fixture('d2000000-0000-4000-8000-000000000003', 'order_ready', 240, false),
    fixture(
      'd2000000-0000-4000-8000-000000000004',
      'order_completed',
      1440,
      true
    ),
    fixture(
      'd2000000-0000-4000-8000-000000000005',
      'order_update',
      2880,
      false
    ),
    fixture('d3000000-0000-4000-8000-000000000001', 'price_drop', 8, false),
    fixture('d3000000-0000-4000-8000-000000000002', 'listing_saved', 62, true, {
      section: 'listing',
    }),
    fixture(
      'd3000000-0000-4000-8000-000000000003',
      'listing_update',
      360,
      false,
      { section: 'listing' }
    ),
    fixture(
      'd3000000-0000-4000-8000-000000000004',
      'listing_expired',
      1560,
      true,
      { section: 'listing' }
    ),
    fixture(
      'd3000000-0000-4000-8000-000000000005',
      'listing_reminder',
      4320,
      false,
      { section: 'listing' }
    ),
    fixture(
      'd4000000-0000-4000-8000-000000000001',
      'notification_test',
      16,
      false
    ),
    fixture(
      'd4000000-0000-4000-8000-000000000002',
      'account_notice',
      720,
      true
    ),
    fixture(
      'd4000000-0000-4000-8000-000000000003',
      'security_notice',
      2160,
      false
    ),
    fixture(
      'd4000000-0000-4000-8000-000000000004',
      'maintenance_notice',
      5760,
      true
    ),
  ]
  return {
    notifications,
    unreadCount: notifications.filter((item) => !item.read_at).length,
    totalCount: notifications.length,
    hasMore: false,
    nextCursor: null,
  }
}

export function filterNotificationDemoFeed(
  source: Feed,
  category: string,
  status: '' | 'read' | 'unread'
): Feed {
  const notifications = source.notifications.filter(
    (item) =>
      (!category || notificationCategory(item) === category) &&
      (!status || (status === 'read' ? Boolean(item.read_at) : !item.read_at))
  )
  return { ...source, notifications }
}
