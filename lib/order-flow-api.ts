import { HandoffError, handoffMessages } from '@/lib/handoff'
import type { HandoffErrorCode } from '@/lib/handoff'
import { marketplaceRequest } from '@/lib/listings-api'

/** Existing participant-scoped /api/order-domain projections. No new server contract. */
export type OrderFulfillmentState = {
  agreement: OrderAgreementState
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
export type OrderAgreementState = {
  orderId: string
  buyerConfirmedAt: string | null
  sellerConfirmedAt: string | null
  preservedProgress: boolean
  complete: boolean
  serverTime: string
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
export type HandoffQrCredential = {
  available: true
  qrToken: string
  expiresAt: string
  serverTime: string
}
export const generateHandoffQr = (id: string, clientActionId: string) =>
  marketplaceRequest<HandoffQrCredential>(
    `/api/order-domain/${encodeURIComponent(id)}/generate-qr`,
    'POST',
    { clientActionId }
  )
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
    | 'confirm-agreement'
    | 'handoff'
    | 'payment'
    | 'received'
    | 'request-cancellation'
    | 'respond-cancellation'
    | 'shipment'
    | 'start-delivery',
  body: Record<string, unknown>
) =>
  action === 'handoff'
    ? verifyHandoff(id, body)
    : marketplaceRequest<unknown>(
        `/api/order-domain/${encodeURIComponent(id)}/${action}`,
        'POST',
        body
      )

async function verifyHandoff(id: string, body: Record<string, unknown>) {
  const response = await fetch(
    `/api/order-domain/${encodeURIComponent(id)}/handoff`,
    {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        'X-Marketplace-Request': '1',
      },
      body: JSON.stringify(body),
    }
  )
  const result = await response.json().catch(() => null)
  if (!response.ok) {
    if (
      result &&
      Object.prototype.hasOwnProperty.call(handoffMessages, result.errorCode)
    )
      throw new HandoffError(
        result.errorCode as HandoffErrorCode,
        typeof result.retryAt === 'string' &&
        Number.isFinite(Date.parse(result.retryAt))
          ? result.retryAt
          : undefined
      )
    throw new Error(
      'Unable to verify handoff. Refresh the Order before retrying.'
    )
  }
  if (result?.verified !== true)
    throw new Error('Unable to confirm handoff. Refresh the Order.')
  return result
}
