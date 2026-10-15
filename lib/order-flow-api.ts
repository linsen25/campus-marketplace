import { marketplaceRequest } from '@/lib/listings-api'

/** Existing participant-scoped /api/order-domain projections. No new server contract. */
export type OrderFulfillmentState = {
  orderId: string
  handoffReady: boolean
  handoffConfirmedAt: string | null
  protectionStartedAt: string | null
  protectionExpiresAt: string | null
  protectionCompletedAt: string | null
  protectionHold: boolean
  caseState: string | null
  payoutEligible: boolean
  serverTime: string
  deliveryStartedAt: string | null
  cancellation: OrderCancellationState
}
export type OrderCancellationState = {
  orderId: string
  deliveryStartedAt: string | null
  canCancel: boolean
  state: 'awaiting_seller' | 'disputed' | 'finalized' | 'payment_pending' | null
  path: 'delivery_compensation' | 'full_refund_request' | 'full_release' | null
  requestedAt: string | null
  requestingRole: 'buyer' | 'seller' | null
  reason: string | null
  note: string | null
  sellerResponse: 'agree' | 'dispute' | null
  sellerRespondedAt: string | null
  settlement: {
    disposition: 'delivery_compensation' | 'full_release'
    securedCents: number
    buyerReleaseCents: number
    sellerDeliveryCompensationCents: number
    platformRetainedCents: 0
    platformReversedCents: number
    sellerSalePayoutCents: 0
    authorizedAt: string
    execution: 'provider_not_integrated'
  } | null
  serverTime: string
}
export type DeliveryAddress = {
  country_code: string
  province_code: string
  city: string
  postal_code: string
  street: string
  unit?: string
  recipient_name?: string
  instructions?: string
}
export type DeliveryCheckoutState = {
  orderId: string
  checkoutClaimDeadlineAt: string | null
  checkoutStartedAt: string | null
  paymentDeadlineAt: string | null
  addressFrozen: boolean
  address: DeliveryAddress | null
  serverTime: string
}
export type CourierState = {
  state: 'delivered' | 'not_shipped' | 'shipped'
  carrierLabel: string | null
  trackingReference: string | null
  shippedAt: string | null
  deliveredAt: string | null
}
export type HandoffCredential = {
  available: boolean
  qrToken?: string
  code?: string
}
export const readOrderFlow = <T>(
  id: string,
  resource:
    | 'cancellation'
    | 'checkout'
    | 'courier'
    | 'credential'
    | 'fulfillment'
) =>
  marketplaceRequest<T>(
    `/api/order-domain/${encodeURIComponent(id)}/${resource}`,
    'GET'
  )

export const actOnOrderFlow = (
  id: string,
  action:
    | 'address'
    | 'case'
    | 'checkout'
    | 'handoff'
    | 'payment'
    | 'received'
    | 'request-cancellation'
    | 'respond-cancellation'
    | 'shipment'
    | 'start-delivery',
  body: Record<string, unknown>
) =>
  marketplaceRequest<unknown>(
    `/api/order-domain/${encodeURIComponent(id)}/${action}`,
    'POST',
    body
  )
