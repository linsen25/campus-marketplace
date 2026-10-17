// Provider-independent staging operations. Never imported by browser components.
import { ListingApiError } from '@/lib/listing-validation'
import {
  createTrustedFinancialClient,
  requireFinancialEnvironment,
} from '@/lib/server/financial-capabilities-service'
import { HandoffApiError, handoffRpcError } from '@/lib/server/handoff-error'
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
      if (name === 'marketplace_verify_handoff') throw handoffRpcError(error)
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
        cancellation: 'marketplace_order_cancellation_state',
        agreement: 'marketplace_order_agreement',
      }
      if (!names[resource]) throw new ListingApiError('Not found.', 404)
      return call(names[resource], { p_order_id: messageUuid(id) })
    },
    async write(id: unknown, action: string, body: Record<string, unknown>) {
      const orderId = messageUuid(id)
      const definitions: Record<string, { name: string; fields: string[] }> = {
        'confirm-exchange': {
          name: 'marketplace_confirm_external_exchange',
          fields: ['clientActionId'],
        },
        'dispute-exchange': {
          name: 'marketplace_dispute_external_exchange',
          fields: ['reason', 'clientActionId'],
        },
        'confirm-agreement': {
          name: 'marketplace_confirm_order_agreement',
          fields: [],
        },
        'generate-qr': {
          name: 'marketplace_generate_handoff_qr',
          fields: ['clientActionId'],
        },
        checkout: { name: 'marketplace_start_delivery_checkout', fields: [] },
        'start-delivery': {
          name: 'marketplace_start_seller_delivery',
          fields: ['clientActionId'],
        },
        'request-cancellation': {
          name: 'marketplace_request_delivery_full_refund',
          fields: ['reason', 'note', 'clientActionId'],
        },
        'respond-cancellation': {
          name: 'marketplace_respond_delivery_cancellation',
          fields: ['response', 'clientActionId'],
        },
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
      if (
        action === 'payment' &&
        process.env.STRIPE_PROVIDER_ENABLED === 'true'
      )
        throw new ListingApiError(
          'Order payments are not enabled in this Stripe setup phase.',
          503
        )
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
        note: 'p_note',
        response: 'p_response',
        carrierLabel: 'p_carrier_label',
        trackingReference: 'p_tracking_reference',
      }
      for (const field of definition.fields)
        params[mapping[field]] =
          field === 'clientActionId' ? messageUuid(body[field]) : body[field]
      // Reuse the existing staging simulator's server-selected outcome. A browser
      // supplies neither financial amounts nor a Paid/Failed outcome or resolver.
      const trusted =
        action === 'payment' ? createTrustedFinancialClient() : null
      const data = await call(definition.name, params)
      if (action === 'handoff' && data?.errorCode) {
        const code = data.errorCode
        if (
          [
            'invalid_handoff_credential',
            'numeric_temporarily_locked',
            'handoff_already_redeemed',
            'qr_expired',
          ].includes(code)
        )
          throw new HandoffApiError(
            code,
            409,
            code === 'numeric_temporarily_locked' &&
            typeof data.retryAt === 'string' &&
            Number.isFinite(Date.parse(data.retryAt))
              ? data.retryAt
              : undefined
          )
        throw new HandoffApiError('handoff_not_ready', 409)
      }
      if (data?.errorCode)
        throw new ListingApiError(
          'Review your payment method and current Order state before retrying.',
          409
        )
      if (trusted && data.status === 'processing') {
        const result = await trusted.rpc('marketplace_resolve_campus_payment', {
          p_attempt_id: data.attemptId,
          p_success: true,
        })
        if (result.error)
          throw new ListingApiError(
            'Payment is still being confirmed. Refresh the Order to review its authoritative state.',
            503
          )
        return { attemptId: data.attemptId, status: result.data.status }
      }
      return data
    },
  }
}
