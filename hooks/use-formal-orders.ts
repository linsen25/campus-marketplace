import { useCallback, useEffect, useRef, useState } from 'react'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { marketplaceRequest } from '@/lib/listings-api'
import { connectMessagesRealtime } from '@/lib/messages-realtime'
import { getOrders } from '@/lib/orders-api'
import type { FormalOrder, FormalOrders } from '@/types/order'

export function useFormalOrders(workspace: 'purchases' | 'sales') {
  const session = useMarketplaceSession()
  const userId = session.seller?.id
  const sessionRefresh = session.refresh
  const [data, setData] = useState<FormalOrders | null>(null)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)
  const generation = useRef(0)
  const version = useRef(0)
  const exactVersion = useRef(0)
  const applyOrder = useCallback((order: FormalOrder, serverTime: string) => {
    version.current++
    exactVersion.current++
    setData((current) => ({
      serverTime,
      orders: [
        ...(current?.orders || []).filter((value) => value.id !== order.id),
        order,
      ],
    }))
    setOffset(Date.parse(serverTime) - Date.now())
  }, [])
  const refresh = useCallback(async () => {
    if (!userId) return
    const scope = generation.current
    const request = ++version.current
    try {
      const result = await getOrders(workspace)
      if (scope === generation.current && request === version.current) {
        setData(result)
        setOffset(Date.parse(result.serverTime) - Date.now())
        setError('')
      }
    } catch {
      if (scope === generation.current && request === version.current)
        setError('Unable to load Orders. Please retry.')
    }
  }, [userId, workspace])
  const refreshOrder = useCallback(
    async (id: string) => {
      if (!userId) throw new Error('Sign in to refresh the Order.')
      const scope = generation.current
      const request = ++exactVersion.current
      // Background workspace reads must not invalidate the mutation's exact read.
      version.current++
      const result = await marketplaceRequest<{
        order: FormalOrder
        serverTime: string
      }>(`/api/orders/${encodeURIComponent(id)}`, 'GET')
      if (scope !== generation.current || request !== exactVersion.current)
        throw new Error('Order view changed. Refresh the current Order.')
      if (
        result.order.id !== id ||
        (result.order.buyerId !== userId && result.order.sellerId !== userId)
      )
        throw new Error('Order not accessible.')
      version.current++
      setData((current) =>
        current
          ? {
              ...current,
              serverTime: result.serverTime,
              orders: current.orders.map((order) =>
                order.id === id ? result.order : order
              ),
            }
          : current
      )
      setOffset(Date.parse(result.serverTime) - Date.now())
      setError('')
    },
    [userId]
  )
  useEffect(() => {
    const invalidate = () => {
      generation.current++
    }
    invalidate()
    setData(null)
    setError('')
    if (!userId) return undefined
    const update = () => {
      refresh().catch(() => {})
    }
    update()
    const stop = connectMessagesRealtime(userId, update, update, () => {
      invalidate()
      setData(null)
      sessionRefresh().catch(() => {})
    })
    window.addEventListener('marketplace-orders-changed', update)
    window.addEventListener('focus', update)
    // Read boundary also materializes elapsed unpaid reservations; never advance locally.
    const timer = setInterval(update, 15000)
    return () => {
      invalidate()
      stop()
      clearInterval(timer)
      window.removeEventListener('marketplace-orders-changed', update)
      window.removeEventListener('focus', update)
    }
  }, [userId, workspace, refresh, sessionRefresh])
  return {
    data,
    error: session.error || error,
    refresh,
    refreshOrder,
    applyOrder,
    offset,
    userId,
    loading: session.loading || (!data && !error && Boolean(userId)),
  }
}
