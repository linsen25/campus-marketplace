import { normalizeMeetingLabel } from '@/lib/meeting-location'
import type { OfferTerms } from '@/types/offer'

/** Review estimate. Persisted card summaries come from the server's captured baseline. */
export function offerChangedFields(
  terms: OfferTerms,
  baseline: Partial<OfferTerms>
) {
  const current = terms as unknown as Record<string, unknown>
  const prior = baseline as unknown as Record<string, unknown>
  return [
    ['Price', 'itemAmountCents'],
    ['Fulfillment', 'fulfillment'],
    ['Meeting location', 'meetupLocation'],
    ['Meetup time', 'scheduledAt'],
    ['Delivery method', 'deliveryMethod'],
    ['Delivery fee', 'deliveryFeeCents'],
    ['Delivery area', 'deliveryArea'],
    ['Note', 'note'],
  ]
    .filter(([, key]) =>
      key === 'meetupLocation'
        ? normalizeMeetingLabel(current[key]) !==
          normalizeMeetingLabel(prior[key])
        : JSON.stringify(current[key] ?? '') !==
          JSON.stringify(prior[key] ?? '')
    )
    .map(([label]) => label)
}
