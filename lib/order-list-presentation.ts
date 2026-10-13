// Presentation only: never derive terminal state from a clock or payout hold.
type OrderListRecord = {
  id: string
  lifecycle: string
  paymentStatus: string
  createdAt: string
  updatedAt?: string | null
  cancellation?: { at: string } | null
  expiredAt?: string | null
  completedAt?: string | null
  refundedAt?: string | null
}

export type OrderListBucket = 'active' | 'history'

export function orderListOutcome(order: OrderListRecord) {
  if (order.lifecycle === 'cancelled') return 'Cancelled'
  if (order.lifecycle === 'expired') return 'Expired'
  if (order.lifecycle === 'refunded' || order.paymentStatus === 'refunded')
    return 'Refunded'
  if (order.lifecycle === 'completed') return 'Completed'
  return null
}

export function deriveOrderListBucket(order: OrderListRecord): OrderListBucket {
  return orderListOutcome(order) ? 'history' : 'active'
}

function terminalTime(order: OrderListRecord) {
  const outcome = orderListOutcome(order)
  const timestamp = {
    Cancelled: order.cancellation?.at,
    Expired: order.expiredAt,
    Refunded: order.refundedAt,
    Completed: order.completedAt,
  }[outcome || 'Completed']
  for (const value of [timestamp, order.updatedAt, order.createdAt]) {
    const parsed = value ? Date.parse(value) : NaN
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

export function filterOrderList<T extends OrderListRecord>(
  orders: readonly T[],
  bucket: OrderListBucket
): T[] {
  const result = orders.filter(
    (order) => deriveOrderListBucket(order) === bucket
  )
  return bucket === 'history'
    ? result.sort(
        (a, b) => terminalTime(b) - terminalTime(a) || a.id.localeCompare(b.id)
      )
    : result
}
