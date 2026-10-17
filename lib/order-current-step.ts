import type { OrderFlowData } from '@/hooks/use-order-flow'
import type { FormalOrder } from '@/types/order'

export type CurrentOrderStep =
  | 'cancellation'
  | 'cancelled'
  | 'checkout'
  | 'completed'
  | 'delivery'
  | 'exchange'
  | 'expired'
  | 'handoff'
  | 'inspect'
  | 'loading'
  | 'payment'
  | 'protection'
  | 'review'
  | 'shipment'

/** Presentation derivation only; Agreement readiness is server-authoritative. */
export function currentOrderStep(
  order: FormalOrder,
  data: OrderFlowData | null
): CurrentOrderStep {
  if (order.lifecycle !== 'open') return order.lifecycle
  if (!data) return 'loading'
  if (order.v2?.terms.paymentMode === 'external')
    return !data.fulfillment.agreement?.complete ? 'review' : 'exchange'
  if (data.fulfillment.cancellation?.state) return 'cancellation'
  if (data.fulfillment.protectionStartedAt) return 'protection'
  if (order.paymentStatus === 'paid') {
    if (order.v2?.terms.fulfillment === 'delivery') {
      if (order.v2.terms.deliveryMethod === 'courier') return 'shipment'
      return data.fulfillment.deliveryStartedAt ? 'handoff' : 'delivery'
    }
    return 'handoff'
  }
  if (!data.fulfillment.agreement?.complete) return 'review'
  if (
    order.paymentStatus === 'processing' ||
    order.paymentStatus === 'refunded'
  )
    return 'payment'
  if (
    order.v2?.terms.fulfillment === 'delivery' &&
    data.checkout?.checkoutStartedAt
  )
    return 'checkout'
  return order.v2?.terms.fulfillment === 'delivery' ? 'checkout' : 'payment'
}

/** Historical OrderProgress mapping. Local review/Next and tab selection are absent. */
// eslint-disable-next-line complexity -- Explicit authoritative reached-stage mapping for the three approved fulfillment flows.
export function currentOrderProgress(
  order: FormalOrder,
  data: OrderFlowData | null
) {
  const terms = order.v2!.terms
  if (terms.paymentMode === 'external') {
    const steps = [
      'Agreement',
      'Meet / Inspect',
      'Confirm exchange',
      'Completed',
    ]
    const exchange = data?.fulfillment.externalExchange
    let reached = data?.fulfillment.agreement?.complete ? 1 : 0
    if (exchange && exchange.status !== 'awaiting_both') reached = 2
    if (order.lifecycle === 'completed') reached = 4
    const terminal =
      order.lifecycle === 'cancelled' || order.lifecycle === 'expired'
    return {
      steps,
      current: terminal || reached === 4 || !data ? null : reached,
      completed: reached,
      terminal,
    }
  }
  const campus = terms.fulfillment === 'on_campus'
  const courier = !campus && terms.deliveryMethod === 'courier'
  let steps = [
    'Agreement',
    'Payment',
    'Delivery / Inspect',
    'Handoff',
    'Protection',
    'Completed',
  ]
  if (campus)
    steps = [
      'Agreement',
      'Payment',
      'Meet / Inspect',
      'Handoff',
      'Protection',
      'Completed',
    ]
  else if (courier)
    steps = [
      'Agreement',
      'Payment',
      'Shipped',
      'Delivered / Received',
      'Protection',
      'Completed',
    ]
  let reached = data?.fulfillment.agreement?.complete ? 1 : 0
  if (order.paymentPaidAt || order.paymentStatus === 'paid') reached = 2
  if (!campus && !courier && data?.fulfillment.deliveryStartedAt) reached = 3
  if (courier && data?.courier?.shippedAt) reached = 3
  if (courier && data?.courier?.deliveredAt) reached = 4
  if (data?.fulfillment.handoffConfirmedAt) reached = 4
  if (data?.fulfillment.protectionStartedAt) reached = steps.length - 2
  if (order.lifecycle === 'completed') reached = steps.length
  const terminal =
    order.lifecycle === 'cancelled' || order.lifecycle === 'expired'
  return {
    steps,
    current:
      terminal ||
      order.lifecycle === 'completed' ||
      !data ||
      data.fulfillment.cancellation?.state
        ? null
        : reached,
    completed: reached,
    terminal,
  }
}
