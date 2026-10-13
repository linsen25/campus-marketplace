// Provider-independent staging operations. Never imported by browser components.
import { ListingApiError } from '@/lib/listing-validation'
import { requireFinancialEnvironment } from '@/lib/server/financial-capabilities-service'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'

export function createOrderDomainService(context: MarketplaceContext) {
  requireFinancialEnvironment()
  const client = createMarketplaceClient(context)
  async function call(name: string, params: Record<string, unknown>) {
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, params)
    if (error) {
      let status = 503
      if (error.code === '42501') status = 403
      else if (error.code === '23505') status = 409
      else if (['23514', '22P02', '22003'].includes(error.code || ''))
        status = 400
      throw new ListingApiError(
        status === 409
          ? 'Order state changed. Refresh and review.'
          : 'Order operation unavailable for these terms or this account.',
        status
      )
    }
    return data
  }
  return {
    read(id: unknown, resource: string) {
      const names: Record<string, string> = {
        economics: 'marketplace_order_economics',
        checkout: 'marketplace_delivery_checkout',
        fulfillment: 'marketplace_order_fulfillment',
        credential: 'marketplace_handoff_credential',
        courier: 'marketplace_courier_state',
      }
      if (!names[resource]) throw new ListingApiError('Not found.', 404)
      return call(names[resource], { p_order_id: messageUuid(id) })
    },
    write(id: unknown, action: string, body: Record<string, unknown>) {
      const orderId = messageUuid(id)
      const definitions: Record<string, { name: string; fields: string[] }> = {
        checkout: { name: 'marketplace_start_delivery_checkout', fields: [] },
        address: {
          name: 'marketplace_save_delivery_address',
          fields: ['address'],
        },
        payment: {
          name: 'marketplace_start_order_payment',
          fields: ['clientActionId'],
        },
        handoff: {
          name: 'marketplace_verify_handoff',
          fields: ['channel', 'credential', 'clientActionId'],
        },
        case: {
          name: 'marketplace_open_protection_case',
          fields: ['reason', 'clientActionId'],
        },
        shipment: {
          name: 'marketplace_record_courier_shipment',
          fields: ['carrierLabel', 'trackingReference', 'clientActionId'],
        },
        received: {
          name: 'marketplace_confirm_courier_received',
          fields: ['clientActionId'],
        },
      }
      const definition = definitions[action]
      if (!definition) throw new ListingApiError('Not found.', 404)
      if (Object.keys(body).some((key) => !definition.fields.includes(key)))
        throw new ListingApiError('Unexpected Order operation fields.', 400)
      const params: Record<string, unknown> = { p_order_id: orderId }
      const mapping: Record<string, string> = {
        clientActionId: 'p_client_action_id',
        address: 'p_address',
        channel: 'p_channel',
        credential: 'p_credential',
        reason: 'p_reason',
        carrierLabel: 'p_carrier_label',
        trackingReference: 'p_tracking_reference',
      }
      for (const field of definition.fields)
        params[mapping[field]] =
          field === 'clientActionId' ? messageUuid(body[field]) : body[field]
      // Payment remains Processing until separate trusted staging/provider resolution.
      // No privileged resolver or caller-supplied economics is exposed here.
      return call(definition.name, params)
    },
  }
}
