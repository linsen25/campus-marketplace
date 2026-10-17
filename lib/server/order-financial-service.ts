// Server-only trusted simulator. Never import into browser components.
import { ListingApiError } from '@/lib/listing-validation'
import { OrderFinancialError } from '@/lib/order-financial-error'
import {
  createTrustedFinancialClient,
  requireFinancialEnvironment,
} from '@/lib/server/financial-capabilities-service'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import { mapOrder } from '@/lib/server/orders-service'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'

export async function simulateOrderPaymentSuccess(
  context: MarketplaceContext,
  orderId: unknown,
  body: Record<string, unknown>
) {
  requireFinancialEnvironment()
  if (process.env.STRIPE_PROVIDER_ENABLED === 'true')
    throw new ListingApiError(
      'Staging simulation is disabled while Stripe setup is enabled.',
      503
    )
  const user = await requireMarketplaceUser(createMarketplaceClient(context))
  const client = createTrustedFinancialClient()
  // All identities/readiness/provenance are server-derived; only action UUID is input.
  const { data, error } = await client.rpc(
    'marketplace_simulate_order_payment_success',
    {
      p_order_id: messageUuid(orderId),
      p_buyer_id: user.id,
      p_client_action_id: messageUuid(body.clientActionId),
    }
  )
  if (error) {
    const statuses: Record<string, number> = { '42501': 403, '23505': 409 }
    const status = statuses[error.code] || 503
    throw new ListingApiError(
      status === 403
        ? 'Order not accessible.'
        : 'Unable to complete test payment.',
      status
    )
  }
  if (
    data.errorCode === 'order_not_payment_ready' ||
    data.errorCode === 'buyer_payment_method_not_ready'
  )
    throw new OrderFinancialError(data.errorCode)
  if (!data.order || data.order.buyer_id !== user.id)
    throw new ListingApiError('Unable to complete test payment.', 503)
  return { order: mapOrder(data.order), serverTime: data.serverTime }
}
