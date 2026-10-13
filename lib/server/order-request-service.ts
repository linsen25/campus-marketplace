import { ListingApiError } from '@/lib/listing-validation'
import type {
  PreviewRequest,
  PreviewConversationEvent,
} from '@/lib/order-interaction-preview'
import {
  SellerPayoutNotReadyError,
  sellerPayoutNotReady,
} from '@/lib/order-payout-error'
import type { RequestHistory } from '@/lib/order-requests-api'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import {
  requireMessagesEnvironment,
  messageUuid,
} from '@/lib/server/messages-environment'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { MarketplaceContext } from '@/lib/supabase/server'

export function requireOrderRequestEnvironment() {
  if (
    requireMessagesEnvironment() !== 'pcaqxezdfxofysghssyo' ||
    process.env.APP_ENV !== 'staging'
  )
    throw new ListingApiError(
      'Order Requests are not enabled in this environment.',
      503
    )
}
type RequestRow = {
  protocol_version: 1 | 2
  id: string
  conversation_id: string
  listing_id: string
  buyer_id: string
  seller_id: string
  created_at: string
  status: PreviewRequest['status']
  item_amount_cents: number
  listing_title_snapshot: string
  listing_price_cents_snapshot: number
  listing_category_snapshot: string
  listing_media_snapshot: Array<{ path: string }>
  buyer_username_snapshot: string
  seller_username_snapshot: string
  fulfillment_type: 'meet' | 'pickup' | 'shipping'
  place_name: string | null
  scheduled_at: string | null
  shipping_cost_mode: 'flat_rate' | 'included' | 'pending' | null
  shipping_amount_cents: number | null
  shipping_method: string | null
  seller_note: string | null
  cancelled_at: string | null
  replaced_at: string | null
  expired_at: string | null
  cancel_reason_label_snapshot: string | null
  cancel_note: string | null
}
export function mapRequest(row: RequestRow): PreviewRequest {
  // SQL history is V1-only; reject an accidental newer row rather than rendering
  // Buyer-origin proposals with the legacy Seller alignment/action assumptions.
  if (row.protocol_version !== 1)
    throw new ListingApiError('This proposal requires a newer protocol.', 409)
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  return {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    createdAt: row.created_at,
    lifecycle: {
      replacedAt: row.replaced_at || undefined,
      expiredAt: row.expired_at || undefined,
    },
    snapshot: {
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      buyer: row.buyer_username_snapshot,
      seller: row.seller_username_snapshot,
      listing: {
        id: row.listing_id,
        liveId: row.listing_id,
        title: row.listing_title_snapshot,
        price: Number(row.listing_price_cents_snapshot),
        currency: 'CAD',
        category: row.listing_category_snapshot,
        availability: 'available',
        photoUrls: row.listing_media_snapshot.map(
          (image) =>
            `${url}/storage/v1/object/public/listing-images/${image.path}`
        ),
      },
      draft: {
        price: Number(row.item_amount_cents),
        fulfillment: row.fulfillment_type,
        location: row.place_name || '',
        scheduleMode: row.scheduled_at ? 'scheduled' : 'tbd',
        scheduledAt: row.scheduled_at
          ? Date.parse(row.scheduled_at)
          : undefined,
        shippingCost: (
          {
            flat_rate: 'flat',
            pending: 'arranged',
            included: 'included',
          } as const
        )[row.shipping_cost_mode || 'included'],
        shippingFee:
          row.shipping_amount_cents === null
            ? null
            : Number(row.shipping_amount_cents),
        shippingMethod: row.shipping_method || '',
        note: row.seller_note || '',
      },
    },
    ...(row.cancelled_at
      ? {
          cancellation: {
            cancelledBy: 'seller',
            cancelReason: row.cancel_reason_label_snapshot || '',
            cancelNote: row.cancel_note || '',
            cancelledAt: row.cancelled_at,
          },
        }
      : {}),
  }
}
type EventRow = {
  actor_id: string | null
  id: string
  request_id: string
  conversation_id: string
  created_at: string
  event_type: string
  metadata: { reason?: string; note?: string }
}
export function createOrderRequestService(context: MarketplaceContext) {
  requireOrderRequestEnvironment()
  const client = createMarketplaceClient(context)
  async function call(name: string, params: Record<string, unknown>) {
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(name, params)
    if (error) {
      if (error.code === 'P0001' && error.message === sellerPayoutNotReady)
        throw new SellerPayoutNotReadyError()
      let status = 503
      if (error.code === '42501') status = 403
      else if (error.code === '23505') status = 409
      else if (
        ['23514', '22P02', '22007', '22008', '22003'].includes(error.code)
      )
        status = 400
      const errors: Record<number, string> = {
        409: 'The request changed or this submission was already used. Refresh and review before sending.',
        403: 'Request not accessible for this account.',
        400: 'Request terms did not pass validation. Check the amount, location and schedule.',
        503: 'Unable to load Order Requests. Please retry.',
      }
      throw new ListingApiError(errors[status], status)
    }
    return data
  }
  return {
    async history(id: unknown): Promise<RequestHistory> {
      const data = await call('marketplace_order_request_history', {
        p_conversation_id: messageUuid(id),
      })
      return {
        sellerId: data.sellerId,
        buyerId: data.buyerId,
        serverTime: data.serverTime,
        eligibleRequestIds: data.eligibleRequestIds || [],
        requests: data.requests.map(mapRequest),
        events: data.events
          .filter((event: EventRow) =>
            [
              'request_cancelled',
              'request_replaced',
              'request_expired',
            ].includes(event.event_type)
          )
          .map(
            (event: EventRow): PreviewConversationEvent => ({
              actorId: event.actor_id || undefined,
              id: event.id,
              requestId: event.request_id,
              conversationId: event.conversation_id,
              createdAt: event.created_at,
              kind: (
                {
                  request_cancelled: 'request-cancelled',
                  request_replaced: 'request-replaced',
                  request_expired: 'request-expired',
                } as const
              )[
                event.event_type as
                  | 'request_cancelled'
                  | 'request_expired'
                  | 'request_replaced'
              ],
              ...(event.event_type === 'request_cancelled'
                ? {
                    cancellation: {
                      cancelledBy: 'seller',
                      cancelReason: event.metadata.reason || '',
                      cancelNote: event.metadata.note || '',
                      cancelledAt: event.created_at,
                    },
                  }
                : {}),
            })
          ),
      }
    },
    async mutate(action: string, id: unknown, body: Record<string, unknown>) {
      const params: Record<string, unknown> = {
        p_client_action_id: messageUuid(body.clientActionId),
      }
      if (action === 'create')
        params.p_conversation_id = messageUuid(body.conversationId)
      else params.p_request_id = messageUuid(id)
      if (action === 'cancel') {
        params.p_reason_code = body.reasonCode
        params.p_note = body.note
      } else params.p_terms = body.terms
      const data = await call(`marketplace_${action}_order_request`, params)
      return mapRequest(data)
    },
  }
}
