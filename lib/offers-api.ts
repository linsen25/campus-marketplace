import { marketplaceRequest } from '@/lib/listings-api'
import type { Agreement, Offer, OfferEvent, OfferTerms } from '@/types/offer'

export type OfferHistory = {
  offers: Offer[]
  events: OfferEvent[]
  agreements?: Agreement[]
}
export const getOffers = (id: string) =>
  marketplaceRequest<OfferHistory>(
    `/api/offers?conversationId=${encodeURIComponent(id)}`,
    'GET'
  )
export function offerPayload(terms: OfferTerms) {
  const common = {
    item_amount_cents: terms.itemAmountCents,
    note: terms.note,
    payment_mode:
      terms.fulfillment === 'delivery'
        ? 'uu_pay'
        : terms.paymentMode ?? 'uu_pay',
    payment_mode_version: 1,
  }
  return terms.fulfillment === 'on_campus'
    ? {
        ...common,
        fulfillment: 'on_campus',
        meetup_location: terms.meetupLocation,
        ...(terms.meetupLocationProvider && terms.meetupPlaceId
          ? {
              meetup_location_provider: terms.meetupLocationProvider,
              meetup_place_id: terms.meetupPlaceId,
            }
          : {}),
        scheduled_at: terms.scheduledAt,
      }
    : {
        ...common,
        fulfillment: 'delivery',
        delivery_fee_cents: terms.deliveryFeeCents,
        delivery_method: terms.deliveryMethod,
        ...(terms.deliveryArea && {
          delivery_area: {
            country_code: terms.deliveryArea.countryCode,
            province_code: terms.deliveryArea.provinceCode,
            city_label: terms.deliveryArea.cityLabel,
            postal_prefix: terms.deliveryArea.postalPrefix,
          },
        }),
      }
}
export const sendOffer = (
  conversationId: string,
  terms: OfferTerms,
  clientActionId: string,
  comparison?: { id: string; kind: 'counter' | 'revise' }
) =>
  marketplaceRequest<Offer>('/api/offers', 'POST', {
    conversationId,
    terms: offerPayload(terms),
    clientActionId,
    ...(comparison && {
      comparisonOfferId: comparison.id,
      kind: comparison.kind,
    }),
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
export const denyOffer = (id: string, clientActionId: string) =>
  marketplaceRequest<Offer>(
    `/api/offers/${encodeURIComponent(id)}/deny`,
    'POST',
    { clientActionId }
  )
