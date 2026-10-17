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
    ['Payment method', 'paymentMode'],
    ['Meeting location', 'meetupLocation'],
    ['Meetup time', 'scheduledAt'],
    ['Delivery method', 'deliveryMethod'],
    ['Delivery fee', 'deliveryFeeCents'],
    ['Delivery area', 'deliveryArea'],
    ['Note', 'note'],
  ]
    .filter(([, key]) => {
      if (key === 'paymentMode')
        return (current[key] ?? 'uu_pay') !== (prior[key] ?? 'uu_pay')
      if (key === 'meetupLocation')
        return (
          normalizeMeetingLabel(current[key]) !==
          normalizeMeetingLabel(prior[key])
        )
      return (
        JSON.stringify(current[key] ?? '') !== JSON.stringify(prior[key] ?? '')
      )
    })
    .map(([label]) => label)
}
