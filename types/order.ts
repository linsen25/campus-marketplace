import type { PreviewRequest } from '@/lib/order-interaction-preview'
import type { OfferTerms } from '@/types/offer'

/** Participant-readable projection of a persisted Order, never a local preview store. */
export type MeetupRevision = {
  id: string
  revision: number
  baseConfirmedId: string | null
  location: string
  scheduledAt: string
  note: string
  status:
    | 'closed'
    | 'confirmed'
    | 'declined'
    | 'pending'
    | 'superseded'
    | 'withdrawn'
  proposerRole: 'buyer' | 'seller' | 'system'
  deciderRole: 'buyer' | 'seller' | 'system'
  proposedAt: string
  decidedAt: string | null
}
export type OrderMeetup = { mutable: boolean; revisions: MeetupRevision[] }
export type FormalOrder = {
  economics?: {
    itemCents: number
    deliveryCents: number
    buyerServiceFeeCents: number
    buyerTotalCents: number
    sellerPlatformFeeCents: 0
    sellerGrossCents: number
    feeRule: string
  }
  campusPayment?: {
    inspectionConfirmedAt: string | null
    itemCents: number
    feeCents: number
    totalCents: number
    feeRule: string
  }
  meetup?: OrderMeetup

  protocolVersion?: 1 | 2
  v2?: {
    terms: OfferTerms
    condition: string
    description: string
    subcategory: string
    materialHash: string
    askingPriceCents: number
  }
  id: string
  requestId: string
  conversationId: string
  listingId: string
  buyerId: string | null
  sellerId: string | null
  snapshot: PreviewRequest['snapshot']
  lifecycle: 'cancelled' | 'completed' | 'expired' | 'open'
  cancellation?: {
    at: string
    byRole: 'buyer' | 'seller'
    reasonCode: string
    reason: string
    note: string
  } | null
  holdsListing: boolean
  moneyStatus: 'finalized' | 'shipping_pending' | 'v2_pending'
  paymentStatus: 'failed' | 'paid' | 'pending' | 'processing' | 'refunded'
  paymentPaidAt: string | null
  payoutStatus:
    | 'eligible'
    | 'failed'
    | 'not_eligible'
    | 'on_hold'
    | 'paid'
    | 'pending'
    | 'processing'
  fulfillmentStatus: 'awaiting_fulfillment' | 'awaiting_payment' | 'fulfilled'
  itemAmount: number
  shippingAmount: number | null
  serviceFee: number | null
  totalAmount: number | null
  createdAt: string
  acceptedAt?: string | null
  expiredAt?: string | null
  reservationStartedAt: string | null
  reservationExpiresAt: string | null
}
export type FormalOrders = { orders: FormalOrder[]; serverTime: string }
