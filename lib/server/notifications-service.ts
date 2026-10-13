// Server-only; no privileged key or client-selected recipient is used.
import { ListingApiError } from '@/lib/listing-validation'
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
  return {
    list(before: unknown, beforeId: unknown) {
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
      return call('marketplace_notifications', {
        p_before: before ?? null,
        p_before_id: missingId ? null : messageUuid(beforeId),
      })
    },
    markRead(id: unknown) {
      return call('marketplace_mark_notification_read', {
        p_id: messageUuid(id),
      })
    },
  }
}
