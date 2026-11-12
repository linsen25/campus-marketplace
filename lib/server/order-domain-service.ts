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
  async function readExternalParticipantProjection(orderId: string) {
    // The deployed fulfillment projection composes the historical cancellation
    // reader. That reader intentionally remains Western-only for legacy
    // Delivery/cancellation operations, so an ordinary verified Resale
    // participant can receive 42501 even though the external exchange and
    // agreement projections are participant-safe. Use only those two
    // participant-scoped projections as a narrow read fallback; no mutation,
    // payment, cancellation, handoff, or payout capability is widened here.
    const [exchange, agreement] = await Promise.all([
      client.rpc('marketplace_external_exchange', { p_order_id: orderId }),
      client.rpc('marketplace_order_agreement', { p_order_id: orderId }),
    ])
    if (exchange.error || agreement.error || !exchange.data || !agreement.data)
      return null
    return {
      orderId,
      externalExchange: exchange.data,
      interacPayment: null,
      agreement: agreement.data,
      handoffReady: false,
      handoffConfirmedAt: null,
      protectionStartedAt: null,
      protectionExpiresAt: null,
      buyerConfirmedAt: null,
      releaseEligibleAt: null,
      protectionCompletedAt: null,
      protectionHold: false,
      caseState: null,
      payoutEligible: false,
      serverTime:
        typeof agreement.data.serverTime === 'string'
          ? agreement.data.serverTime
          : typeof exchange.data.serverTime === 'string'
          ? exchange.data.serverTime
          : null,
      deliveryStartedAt: null,
      cancellation: null,
    }
  }
  async function call(name: string, params: Record<string, unknown>) {
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, params)
    if (error) {
      if (name === 'marketplace_verify_handoff') throw handoffRpcError(error)
      if (
        error.code === '23514' &&
        [
          'Seller receipt confirmation required before Interac exchange.',
          'Seller receipt confirmation required before Interac completion.',
        ].includes(error.message || '')
      )
        throw new ListingApiError(
          'The buyer must report payment and the seller must confirm receipt before completing this Interac exchange.',
          409
        )
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
    async read(id: unknown, resource: string) {
      const names: Record<string, string> = {
        economics: 'marketplace_order_economics',
        checkout: 'marketplace_delivery_checkout',
        fulfillment: 'marketplace_order_fulfillment',
        credential: 'marketplace_handoff_credential',
        courier: 'marketplace_courier_state',
        cancellation: 'marketplace_order_cancellation_state',
        agreement: 'marketplace_order_agreement',
        'interac-payment': 'marketplace_interac_payment_state',
      }
      if (!names[resource]) throw new ListingApiError('Not found.', 404)
      const orderId = messageUuid(id)
      if (resource === 'fulfillment') {
        try {
          return await call(names[resource], { p_order_id: orderId })
        } catch (error) {
          if (error instanceof ListingApiError && error.status === 403) {
            const fallback = await readExternalParticipantProjection(orderId)
            if (fallback) return fallback
          }
          throw error
        }
      }
      return call(names[resource], { p_order_id: orderId })
    },
    async write(id: unknown, action: string, body: Record<string, unknown>) {
      const orderId = messageUuid(id)
      const definitions: Record<string, { name: string; fields: string[] }> = {
        'confirm-exchange': {
          name: 'marketplace_confirm_external_exchange',
          fields: ['clientActionId'],
        },
        'report-interac-payment': {
          name: 'marketplace_report_interac_payment',
          fields: ['reference'],
        },
        'confirm-interac-receipt': {
          name: 'marketplace_confirm_interac_receipt',
          fields: [],
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
        'confirm-receipt': {
          name: 'marketplace_confirm_buyer_receipt',
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
        reference: 'p_reference',
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
