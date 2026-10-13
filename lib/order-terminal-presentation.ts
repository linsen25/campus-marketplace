import type { FormalOrder } from '@/types/order'

// Persisted lifecycle only; elapsed browser time never manufactures an outcome.
export function terminalOrderOutcome(lifecycle?: FormalOrder['lifecycle']) {
  if (lifecycle === 'expired') return 'Expired'
  if (lifecycle === 'cancelled') return 'Cancelled'
  return null
}

export function orderStatusLabel(order: FormalOrder) {
  if (order.lifecycle === 'expired') return 'Reservation expired'
  if (order.lifecycle === 'cancelled') return 'Order cancelled'
  if (order.protocolVersion === 2) return 'Pending transaction'
  if (order.paymentStatus === 'paid') return 'Payment paid'
  if (order.moneyStatus === 'shipping_pending') return 'Shipping cost pending'
  return 'Reserved / Payment pending'
}
