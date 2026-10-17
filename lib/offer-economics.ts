import type { OfferTerms } from '@/types/offer'

export function buyerServiceFeeDisplay(item: number) {
  if (!Number.isSafeInteger(item) || item < 0)
    throw new RangeError('Invalid preview item amount')
  return item >= 50000 ? 500 : Math.floor((item + 50) / 100)
}

/** Display estimate only. Accept freezes the authoritative server calculation. */
export function offerEconomics(terms: OfferTerms) {
  const item = terms.itemAmountCents
  const delivery = terms.fulfillment === 'delivery' ? terms.deliveryFeeCents : 0
  const fee =
    terms.paymentMode === 'external' ? 0 : buyerServiceFeeDisplay(item)
  return {
    item,
    delivery,
    fee,
    total: item + delivery + fee,
    sellerFee: 0,
    sellerGross: item + delivery,
  }
}
