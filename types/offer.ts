// V2 negotiation DTO. No Accept or Order capability.
export type OfferStatus =
  | 'Accepted'
  | 'Active'
  | 'Closed'
  | 'Expired'
  | 'Replaced'
  | 'Withdrawn'
export type OfferTerms = {
  itemAmountCents: number
  currency: 'CAD'
  note: string
} & (
  | {
      fulfillment: 'delivery'
      deliveryFeeCents: number
      deliveryMethod: 'courier' | 'seller_delivery'
      // Optional only for historical DTO compatibility; new Delivery writes require it.
      deliveryArea?: {
        countryCode: 'CA'
        provinceCode: string
        cityLabel: string
        postalPrefix: string
      }
    }
  | { fulfillment: 'on_campus'; meetupLocation: string; scheduledAt: string }
)
export type Offer = {
  id: string
  protocolVersion: 2
  conversationId: string
  listingId: string
  buyerId: string
  sellerId: string
  senderId: string
  recipientId: string
  status: OfferStatus
  createdAt: string
  updatedAt: string
  terms: OfferTerms
  listingUpdatedAtAtOffer: string | null
  linkedOrderId: string | null
  canAccept?: boolean
  acceptBlockReason?: string | null
  replacementOfferId: string | null
  replacedAt: string | null
  withdrawnAt: string | null
  withdrawnBy: string | null
  withdrawalNote: string | null
  canWithdraw: boolean
}
export type OfferEvent = {
  id: string
  offerId: string
  conversationId: string
  actorId: string | null
  actorRole: 'buyer' | 'seller' | 'system'
  type:
    | 'buyer_inspection_confirmed'
    | 'listing_pending'
    | 'meetup_closed'
    | 'meetup_confirmed'
    | 'meetup_declined'
    | 'meetup_initial_confirmed'
    | 'meetup_proposed'
    | 'meetup_superseded'
    | 'meetup_withdrawn'
    | 'offer_accepted'
    | 'offer_closed'
    | 'offer_created'
    | 'offer_replaced'
    | 'offer_withdrawn'
    | 'order_cancelled'
    | 'order_created'
    | 'order_no_show_expired'
    | 'payment_failed'
    | 'payment_paid'
    | 'payment_started'
  createdAt: string
}
