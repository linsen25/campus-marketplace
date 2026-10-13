import { buyerServiceFeeDisplay } from '@/lib/offer-economics'
import type { ChatListing } from '@/types/conversation'
import { formatListingPrice } from '@/utils/format-listing-price'

import type { ScheduleSnapshot } from './order-schedule-preview'

/** UI preview only. No Order record, API contract or payment policy. */
export type OrderRequestVisual = ScheduleSnapshot & {
  price: number
  fulfillment: 'meet' | 'pickup' | 'shipping'
  location: string
  shippingCost: 'arranged' | 'flat' | 'included'
  shippingFee: number | null
  shippingMethod: string
  note: string
}

export type OrderDetailVisual = {
  buyerId?: string
  sellerId?: string
  listing: ChatListing
  draft: OrderRequestVisual
  buyer: string
  seller: string
}

export const fulfillmentLabels = {
  pickup: 'Pickup',
  meet: 'Meet in person',
  shipping: 'Shipping',
}

// Display estimate only; V1 historical/server amounts remain unchanged.
export function calculateOrderVisualAmounts(item: number, shipping = 0) {
  if (
    ![item, shipping].every(
      (value) => Number.isSafeInteger(value) && value >= 0
    )
  )
    throw new RangeError('Invalid preview amount')
  const serviceFee = buyerServiceFeeDisplay(item)
  const total = item + shipping + serviceFee
  if (!Number.isSafeInteger(total))
    throw new RangeError('Preview total is too large')
  return { item, shipping, serviceFee, sellerFee: 0, total }
}

export const formatOrderVisualAmount = (cents: number) =>
  cents === 0 ? 'CA$0' : formatListingPrice(cents)

export const shippingCostLabels = {
  included: 'Included',
  flat: 'Flat rate',
  arranged: 'To be arranged',
}

export function previewShippingLabel(draft: OrderRequestVisual) {
  if (draft.shippingCost === 'included') return 'Included'
  if (draft.shippingCost === 'arranged') return 'To be arranged'
  if (draft.shippingFee === null)
    throw new RangeError('Missing flat-rate shipping amount')
  return formatOrderVisualAmount(draft.shippingFee)
}

/** Pending shipping has no payable amounts; it must never be treated as zero. */
export function calculateOrderRequestVisualAmounts(draft: OrderRequestVisual) {
  if (draft.fulfillment === 'shipping' && draft.shippingCost === 'arranged')
    return null
  const shipping =
    draft.fulfillment === 'shipping' && draft.shippingCost === 'flat'
      ? draft.shippingFee
      : 0
  if (shipping === null)
    throw new RangeError('Missing flat-rate shipping amount')
  return calculateOrderVisualAmounts(draft.price, shipping)
}

export function compactShippingTerms(draft: OrderRequestVisual) {
  const item = formatOrderVisualAmount(draft.price)
  if (draft.shippingCost === 'included') return `${item} · Shipping included`
  if (draft.shippingCost === 'arranged') return `${item} · Shipping TBD`
  return `${item} + ${previewShippingLabel(draft)} shipping`
}
