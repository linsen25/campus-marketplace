import { marketplaceRequest } from '@/lib/listings-api'
import type { Offer, OfferEvent, OfferTerms } from '@/types/offer'

export type OfferHistory = { offers: Offer[]; events: OfferEvent[] }
export const getOffers = (id: string) =>
  marketplaceRequest<OfferHistory>(
    `/api/offers?conversationId=${encodeURIComponent(id)}`,
    'GET'
  )
export function offerPayload(terms: OfferTerms) {
  const common = { item_amount_cents: terms.itemAmountCents, note: terms.note }
  return terms.fulfillment === 'on_campus'
    ? {
        ...common,
        fulfillment: 'on_campus',
        meetup_location: terms.meetupLocation,
        scheduled_at: terms.scheduledAt,
      }
    : {
        ...common,
        fulfillment: 'delivery',
        delivery_fee_cents: terms.deliveryFeeCents,
        delivery_method: terms.deliveryMethod,
      }
}
export const sendOffer = (
  conversationId: string,
  terms: OfferTerms,
  clientActionId: string
) =>
  marketplaceRequest<Offer>('/api/offers', 'POST', {
    conversationId,
    terms: offerPayload(terms),
    clientActionId,
  })
export const withdrawOffer = (id: string, clientActionId: string) =>
  marketplaceRequest<Offer>(
    `/api/offers/${encodeURIComponent(id)}/withdraw`,
    'POST',
    { clientActionId }
  )

export const acceptOffer = (id: string, clientActionId: string) =>
  marketplaceRequest<{ orderId: string; buyerId: string; sellerId: string }>(
    `/api/offers/${encodeURIComponent(id)}/accept`,
    'POST',
    { clientActionId }
  )
