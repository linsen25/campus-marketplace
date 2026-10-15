import { useCallback, useEffect, useRef, useState } from 'react'

import { readOrderFlow } from '@/lib/order-flow-api'
import type {
  CourierState,
  DeliveryCheckoutState,
  HandoffCredential,
  OrderFulfillmentState,
} from '@/lib/order-flow-api'
import type { FormalOrder } from '@/types/order'

export type OrderFlowData = {
  fulfillment: OrderFulfillmentState
  checkout: DeliveryCheckoutState | null
  courier: CourierState | null
  credential: HandoffCredential | null
}

/** All progression comes from existing server reads; no local transaction transitions. */
export function useOrderFlow(order: FormalOrder, role: 'buyer' | 'seller') {
  const terms = order.v2!.terms
  const delivery = terms.fulfillment === 'delivery'
  const courier = delivery && terms.deliveryMethod === 'courier'
  const scope = `${order.id}:${role}:${order.lifecycle}:${order.paymentStatus}`
  const generation = useRef(0)
  const [result, setResult] = useState<{
    scope: string
    data: OrderFlowData
  } | null>(null)
  const [failure, setFailure] = useState<{
    scope: string
    message: string
  } | null>(null)
  const refresh = useCallback(async () => {
    const request = ++generation.current
    try {
      const [fulfillment, checkout, shipment] = await Promise.all([
        readOrderFlow<OrderFulfillmentState>(order.id, 'fulfillment'),
        delivery
          ? readOrderFlow<DeliveryCheckoutState>(order.id, 'checkout')
          : null,
        courier ? readOrderFlow<CourierState>(order.id, 'courier') : null,
      ])
      if (
        fulfillment.orderId !== order.id ||
        (checkout && checkout.orderId !== order.id)
      )
        throw new Error('Order context changed. Refresh this Order.')
      // Never request Buyer-held secrets before Paid, for Seller, or for Courier.
      const credential =
        role === 'buyer' &&
        !courier &&
        order.lifecycle === 'open' &&
        order.paymentStatus === 'paid' &&
        fulfillment.handoffReady
          ? await readOrderFlow<HandoffCredential>(order.id, 'credential')
          : null
      if (request === generation.current) {
        setResult({
          scope,
          data: { fulfillment, checkout, courier: shipment, credential },
        })
        setFailure(null)
      }
    } catch {
      if (request === generation.current) {
        setResult(null)
        setFailure({
          scope,
          message:
            'Unable to load the current transaction step. Refresh to retry.',
        })
      }
      throw new Error('Unable to refresh transaction state.')
    }
  }, [
    scope,
    order.id,
    order.lifecycle,
    order.paymentStatus,
    role,
    delivery,
    courier,
  ])
  // Mutation callbacks may span a parent Order update; refresh the latest scope.
  const latestRefresh = useRef(refresh)
  latestRefresh.current = refresh
  const refreshLatest = useCallback(() => latestRefresh.current(), [])
  useEffect(() => {
    refresh().catch(() => {})
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This is an async request generation, not a DOM ref; invalidate the latest request on cleanup.
      generation.current++
    }
  }, [refresh, order])
  return {
    data: result?.scope === scope ? result.data : null,
    error: failure?.scope === scope ? failure.message : '',
    refresh: refreshLatest,
  }
}
