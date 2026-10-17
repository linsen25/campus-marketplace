// Server-only; no privileged key or client-selected recipient is used.
import { ListingApiError } from '@/lib/listing-validation'
import {
  notificationCategories,
  notificationCategory,
} from '@/lib/notification-category'
import type { NotificationItem } from '@/lib/notification-category'
import { requireFinancialEnvironment } from '@/lib/server/financial-capabilities-service'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'

export function createNotificationsService(context: MarketplaceContext) {
  requireFinancialEnvironment()
  const client = createMarketplaceClient(context)
  async function call(name: string, params: Record<string, unknown>) {
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, params)
    if (error) {
      let status = 503
      if (error.code === '42501') status = 403
      if (error.code === '23514') status = 400
      throw new ListingApiError(
        'Unable to complete notification operation.',
        status
      )
    }
    return data
  }
  async function provenanceRows(
    table: 'conversations' | 'orders',
    ids: string[]
  ) {
    if (!ids.length) return []
    const columns =
      table === 'conversations'
        ? 'id,channel:listing_channel_snapshot,shopName:shop_name_snapshot'
        : 'id,channel:listing_snapshot->>listingChannel,shopName:listing_snapshot->>shopName'
    const { data, error } = await client
      .from(table)
      .select(columns)
      .in('id', ids)
    // Participant RLS normally omits inaccessible rows. Explicit permission denial
    // also makes supplemental context unavailable; other backend failures surface.
    if (error?.code === '42501') return []
    if (error)
      throw new ListingApiError('Unable to load notification context.', 503)
    return (data || []) as unknown as Array<{
      id: string
      channel: string | null
      shopName: string | null
    }>
  }
  // Notification Center only. Realtime signals/popups and email intentionally stay generic.
  async function enrich<T extends { notifications: NotificationItem[] }>(
    page: T
  ): Promise<T> {
    const uuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    const ids = (section: string, key: string) =>
      Array.from(
        new Set(
          page.notifications.flatMap((item) => {
            const id = item.destination[key]
            return item.destination.section === section &&
              typeof id === 'string' &&
              uuid.test(id)
              ? [id]
              : []
          })
        )
      )
    const [conversations, orders] = await Promise.all([
      provenanceRows('conversations', ids('messages', 'conversationId')),
      provenanceRows('orders', ids('orders', 'orderId')),
    ])
    const conversationMap = new Map(conversations.map((row) => [row.id, row]))
    const orderMap = new Map(orders.map((row) => [row.id, row]))
    return {
      ...page,
      notifications: page.notifications.map((item) => {
        const d = item.destination
        const source = d.section === 'messages' ? conversationMap : orderMap
        const id = d.section === 'messages' ? d.conversationId : d.orderId
        const row = ['messages', 'orders'].includes(String(d.section))
          ? source.get(String(id))
          : undefined
        if (row?.channel !== 'shop' || !row.shopName?.trim()) return item
        return {
          ...item,
          listingProvenance: {
            channel: 'shop' as const,
            shopName: row.shopName,
          },
        }
      }),
    }
  }
  return {
    // eslint-disable-next-line complexity -- Cursor validation and two independent filters retain the existing recipient-scoped paging contract.
    async list(
      before: unknown,
      beforeId: unknown,
      category?: unknown,
      status?: unknown
    ) {
      if (status !== undefined && status !== 'read' && status !== 'unread')
        throw new ListingApiError('Invalid notification status.')
      if (
        category !== undefined &&
        !notificationCategories.includes(category as never)
      )
        throw new ListingApiError('Invalid notification category.')
      const missingBefore = before === null || before === undefined
      const missingId = beforeId === null || beforeId === undefined
      if (missingBefore !== missingId)
        throw new ListingApiError('Complete notification cursor required.')
      if (
        !missingBefore &&
        (typeof before !== 'string' ||
          !/(Z|[+-][0-9]{2}:[0-9]{2})$/.test(before) ||
          !Number.isFinite(Date.parse(before)))
      )
        throw new ListingApiError('Invalid notification cursor.')
      let cursor = {
        p_before: before ?? null,
        p_before_id: missingId ? null : messageUuid(beforeId),
      }
      if (category === undefined && status === undefined)
        return enrich(await call('marketplace_notifications', cursor))
      // Scan authoritative recipient-scoped pages, not just the visible page.
      const notifications: NotificationItem[] = []
      let unreadCount = 0
      const result = () => {
        const hasMore = notifications.length > 50
        const last = notifications[Math.min(notifications.length, 50) - 1]
        return {
          notifications: notifications.slice(0, 50),
          unreadCount,
          hasMore,
          nextCursor: hasMore
            ? { before: last.created_at, beforeId: last.id }
            : null,
        }
      }
      for (;;) {
        const page = await call('marketplace_notifications', cursor)
        unreadCount = page.unreadCount
        for (let i = 0; i < page.notifications.length; i++) {
          const item: NotificationItem = page.notifications[i]
          cursor = { p_before: item.created_at, p_before_id: item.id }
          if (
            (category === undefined ||
              notificationCategory(item) === category) &&
            (status === undefined ||
              (status === 'read' ? Boolean(item.read_at) : !item.read_at))
          )
            notifications.push(item)
          // One matching lookahead avoids a misleading Load more for a tail
          // containing only other categories. Resume at the 50th match.
          if (notifications.length === 51) return enrich(result())
        }
        if (page.notifications.length < 50) return enrich(result())
      }
    },
    markRead(id: unknown) {
      return call('marketplace_mark_notification_read', {
        p_id: messageUuid(id),
      })
    },
    markAllRead() {
      return call('marketplace_mark_all_notifications_read', {})
    },
    batch(ids: unknown, action: unknown) {
      if (
        !Array.isArray(ids) ||
        !ids.length ||
        ids.length > 500 ||
        (action !== 'markRead' && action !== 'delete')
      )
        throw new ListingApiError('Invalid notification batch.')
      return call('marketplace_mutate_notifications', {
        p_ids: Array.from(new Set(ids.map(messageUuid))),
        p_action: action,
      })
    },
  }
}
