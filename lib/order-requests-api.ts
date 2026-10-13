import { marketplaceRequest } from '@/lib/listings-api'
import type {
  PreviewRequest,
  PreviewConversationEvent,
} from '@/lib/order-interaction-preview'
import type { OrderRequestVisual } from '@/lib/order-visual-preview'
import type { FormalOrder } from '@/types/order'

export const requestCancelReasons: Record<string, string> = {
  incorrect_details: 'Incorrect transaction details',
  item_unavailable: 'Item is no longer available',
  cannot_complete: 'Cannot complete the transaction',
  sent_by_mistake: 'Sent by mistake',
  other: 'Other',
}
export type RequestHistory = {
  eligibleRequestIds?: string[]
  requests: PreviewRequest[]
  events: PreviewConversationEvent[]
  sellerId: string | null
  buyerId: string | null
  serverTime: string
}
const base = '/api/order-requests'
export const acceptOrderRequest = (id: string, clientActionId: string) =>
  marketplaceRequest<{
    order: FormalOrder
    serverTime: string
  }>(`${base}/${id}/accept`, 'POST', { clientActionId })
export const getOrderRequests = (conversationId: string) =>
  marketplaceRequest<RequestHistory>(
    `${base}?conversationId=${encodeURIComponent(conversationId)}`,
    'GET'
  )
export function submitOrderRequest(
  conversationId: string,
  draft: OrderRequestVisual,
  clientActionId: string,
  replaceRequestId?: string
) {
  return marketplaceRequest(
    `${base}${
      replaceRequestId ? `/${encodeURIComponent(replaceRequestId)}/replace` : ''
    }`,
    'POST',
    {
      conversationId,
      clientActionId,
      terms: {
        item_amount_cents: draft.price,
        fulfillment_type: draft.fulfillment,
        ...(draft.fulfillment === 'shipping'
          ? {
              shipping_cost_mode: {
                included: 'included',
                flat: 'flat_rate',
                arranged: 'pending',
              }[draft.shippingCost],
              shipping_amount_cents: {
                flat: draft.shippingFee,
                included: 0,
                arranged: null,
              }[draft.shippingCost],
              shipping_method: draft.shippingMethod,
            }
          : {
              place_name: draft.location,
              scheduled_at: new Date(draft.scheduledAt || 0).toISOString(),
            }),
        seller_note: draft.note,
      },
    }
  )
}
export const cancelOrderRequest = (
  requestId: string,
  reason: string,
  note: string,
  clientActionId: string
) => {
  const reasonCode = Object.keys(requestCancelReasons).find(
    (key) => requestCancelReasons[key] === reason
  )
  return marketplaceRequest(
    `${base}/${encodeURIComponent(requestId)}/cancel`,
    'POST',
    { reasonCode, note, clientActionId }
  )
}
