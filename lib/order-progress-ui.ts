import type { FormalOrder } from '@/types/order'

type ViewerRole = 'buyer' | 'seller'
export type FormalOrderPresentation = {
  steps: readonly string[]
  currentStep: number | null
  completedSteps: number
  terminal: boolean
  title: string
  description: string
  showReservation: boolean
  showMeeting: boolean
}

const meetingPresentation = {
  buyer: {
    steps: [
      'Order accepted',
      'Payment',
      'Meet & inspect',
      'Handoff confirmed',
      'Marketplace Protection',
      'Completed',
    ],
    title: 'Meet the seller',
    description:
      'Inspect the item before confirming handoff. Handoff controls are not enabled yet.',
  },
  seller: {
    steps: [
      'Order accepted',
      'Buyer payment',
      'Meet buyer / handoff',
      'Handoff confirmed',
      'Payout on hold',
      'Payout',
    ],
    title: 'Meet the buyer',
    description:
      'Buyer payment has been confirmed. Handoff controls are not enabled yet.',
  },
}
const shippingPresentation = {
  buyer: {
    steps: [
      'Order accepted',
      'Payment',
      'Shipped',
      'Received',
      'Marketplace Protection',
      'Completed',
    ],
    title: 'Waiting for seller to ship',
    description:
      'Payment is confirmed. Shipment and tracking controls are not enabled yet.',
  },
  seller: {
    steps: [
      'Order accepted',
      'Buyer payment',
      'Ship item',
      'Delivered / Protection',
      'Payout',
    ],
    title: 'Ship the item',
    description:
      'Buyer payment has been confirmed. Shipping fulfillment controls are not enabled yet.',
  },
}

/** Read-only interpretation of persisted facts. No account metadata or transitions. */
export function deriveOrderPresentation(
  order: FormalOrder,
  role: ViewerRole
): FormalOrderPresentation {
  const buyer = role === 'buyer'
  const shipping = order.snapshot.draft.fulfillment === 'shipping'
  const quote = shipping && order.moneyStatus === 'shipping_pending'
  const variant = shipping
    ? shippingPresentation[role]
    : meetingPresentation[role]
  const steps = [...variant.steps]
  if (quote) steps.splice(1, 0, buyer ? 'Shipping quote' : 'Set shipping cost')
  const base: FormalOrderPresentation = {
    steps,
    currentStep: 1,
    completedSteps: 1,
    terminal: false,
    title: buyer ? 'Complete payment' : 'Waiting for buyer payment',
    description: buyer
      ? 'Review Payment for your payment method. Live payment integration is not enabled yet.'
      : 'Do not hand over the item until payment is confirmed.',
    showReservation:
      order.paymentStatus === 'pending' &&
      order.holdsListing &&
      Boolean(order.reservationExpiresAt),
    showMeeting: false,
  }
  if (order.lifecycle === 'expired')
    return {
      ...base,
      terminal: true,
      currentStep: null,
      title: 'Reservation expired',
      description: buyer
        ? 'No payment was completed.'
        : 'The buyer did not complete payment before the reservation ended.',
      showReservation: false,
    }
  if (quote)
    return {
      ...base,
      title: buyer ? 'Waiting for shipping quote' : 'Set shipping cost',
      description:
        'The final shipping cost must be agreed before payment. Shipping quote controls are not enabled yet. No inventory reservation or payment countdown has started.',
      showReservation: false,
    }
  if (order.paymentStatus === 'paid')
    return {
      ...base,
      // Paid is proven; shipment/handoff/protection milestones are not implemented.
      currentStep: null,
      completedSteps: 2,
      title: variant.title,
      description: variant.description,
      showReservation: false,
      showMeeting: !shipping,
    }
  if (order.paymentStatus !== 'pending')
    return {
      ...base,
      title: {
        processing: 'Payment processing',
        failed: 'Payment needs attention',
        refunded: 'Payment refunded',
      }[order.paymentStatus],
      description:
        'Review the payment status. Further payment and fulfillment actions are not enabled yet.',
      showReservation: false,
    }
  return base
}
