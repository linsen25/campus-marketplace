import type { OrderFlowData } from '@/hooks/use-order-flow'
import type { CurrentOrderStep } from '@/lib/order-current-step'
import { currentOrderProgress } from '@/lib/order-current-step'
import type { FormalOrder } from '@/types/order'

export type OrderPage =
  | 'closed'
  | 'completed'
  | 'fulfillment'
  | 'handoff'
  | 'payment'
  | 'protection'
  | 'review'

export function orderNumber(id: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    id
  )
    ? id.replaceAll('-', '').toUpperCase()
    : null
}

/** A view boundary, never a transaction transition or a Stepper input. */
export function orderPresentation(
  order: FormalOrder,
  data: OrderFlowData | null
) {
  const pages: OrderPage[] = [
    'review',
    'payment',
    'fulfillment',
    'handoff',
    'protection',
    'completed',
  ]
  if (order.lifecycle === 'cancelled' || order.lifecycle === 'expired') {
    const reached = currentOrderProgress(order, data).completed
    const history = pages.slice(0, Math.max(2, Math.min(5, reached)))
    return {
      pages: [...history, 'closed' as const],
      current: history.length,
      maximum: history.length,
    }
  }
  if (order.lifecycle === 'completed') return { pages, current: 5, maximum: 5 }
  if (!data) return { pages, current: 0, maximum: 0 }
  if (data.fulfillment.protectionStartedAt)
    return { pages, current: 4, maximum: 4 }
  if (order.paymentStatus === 'paid') {
    const campus = order.v2!.terms.fulfillment === 'on_campus'
    const courier =
      order.v2!.terms.fulfillment === 'delivery' &&
      order.v2!.terms.deliveryMethod === 'courier'
    const advanced = courier
      ? Boolean(data.courier?.shippedAt)
      : !campus && Boolean(data.fulfillment.deliveryStartedAt)
    const current = advanced ? 3 : 2
    const maximum = campus && data.fulfillment.handoffReady ? 3 : current
    return { pages, current, maximum }
  }
  const current =
    ['processing', 'failed', 'refunded'].includes(order.paymentStatus) ||
    data.checkout?.checkoutStartedAt
      ? 1
      : 0
  // Agreement review may always open Payment; unpaid fulfillment remains inaccessible.
  return { pages, current, maximum: 1 }
}

export function orderPageAction(
  order: FormalOrder,
  data: OrderFlowData | null,
  page: OrderPage
): CurrentOrderStep {
  if (page === 'closed')
    return order.lifecycle === 'expired' ? 'expired' : 'cancelled'
  if (page === 'completed') return 'completed'
  if (page === 'review') return 'review'
  if (!data) return 'loading'
  if (data.fulfillment.cancellation?.state) return 'cancellation'
  if (page === 'payment')
    return order.v2!.terms.fulfillment === 'delivery' &&
      ['pending', 'failed'].includes(order.paymentStatus)
      ? 'checkout'
      : 'payment'
  if (page === 'protection') return 'protection'
  if (order.v2!.terms.fulfillment === 'on_campus') return 'handoff'
  if (order.v2!.terms.deliveryMethod === 'courier') return 'shipment'
  return page === 'handoff' ? 'handoff' : 'delivery'
}
