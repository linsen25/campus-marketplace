// Server-only, default-off B26-B coordinator. The RPC owns all lifecycle facts;
// this module supplies no Shop, Offer, Conversation, timestamp or message input.
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'

export type ShopSuspensionLifecycleResult = {
  enabled: boolean
  busy: boolean
  scanned: number
  offersClosed: number
  messagesInserted: number
  cyclesReopened: number
}

export async function drainShopSuspensionLifecycle(): Promise<ShopSuspensionLifecycleResult> {
  if (process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED !== 'true')
    return {
      enabled: false,
      busy: false,
      scanned: 0,
      offersClosed: 0,
      messagesInserted: 0,
      cyclesReopened: 0,
    }
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_shop_membership_lifecycle',
    { p_action: 'process_due', p_limit: 20 }
  )
  if (error) throw new Error('Shop membership lifecycle reconciliation failed.')
  const value = data as Partial<ShopSuspensionLifecycleResult> | null
  return {
    enabled: true,
    busy: value?.busy === true,
    scanned: Number(value?.scanned || 0),
    offersClosed: Number(value?.offersClosed || 0),
    messagesInserted: Number(value?.messagesInserted || 0),
    cyclesReopened: Number(value?.cyclesReopened || 0),
  }
}
