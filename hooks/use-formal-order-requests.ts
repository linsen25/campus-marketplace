import { useCallback, useEffect, useRef, useState } from 'react'

import { getOrderRequests } from '@/lib/order-requests-api'
import type { RequestHistory } from '@/lib/order-requests-api'

export function useFormalOrderRequests(
  conversationId: string,
  currentUserId: string,
  enabled: boolean
) {
  const [history, setHistory] = useState<RequestHistory | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(enabled)
  const generation = useRef(0)
  const requests = useRef(0)
  // A successful mutation is an interaction barrier, not a fabricated Request status.
  const accepted = useRef(new Set<string>())
  const [pendingAcceptanceIds, setPendingAcceptanceIds] = useState<
    readonly string[]
  >([])
  const scope = `${currentUserId}:${conversationId}`
  const currentScope = useRef(scope)
  currentScope.current = scope
  const markAcceptanceSucceeded = useCallback(
    (id: string) => {
      if (currentScope.current !== scope) return
      requests.current++ // Discard history reads started before the successful Accept.
      accepted.current.add(id)
      setPendingAcceptanceIds(Array.from(accepted.current))
    },
    [scope]
  )
  const isAcceptanceBlocked = useCallback(
    (id: string) => accepted.current.has(id),
    []
  )
  const refresh = useCallback(async () => {
    if (currentScope.current !== scope) return
    const version = generation.current
    const request = ++requests.current
    try {
      const result = await getOrderRequests(conversationId)
      if (generation.current === version && requests.current === request) {
        setHistory(result)
        accepted.current.forEach((id) => {
          const value = result.requests.find((item) => item.id === id)
          if (!value || value.status !== 'active') accepted.current.delete(id)
        })
        setPendingAcceptanceIds(Array.from(accepted.current))
        setError(
          accepted.current.size
            ? 'Acceptance succeeded. Request state is still awaiting confirmation. Please retry.'
            : ''
        )
        setLoading(false)
      }
    } catch {
      if (generation.current === version && requests.current === request) {
        setError(
          accepted.current.size
            ? 'Acceptance succeeded, but Request state could not be refreshed. Accept remains unavailable. Please retry.'
            : 'Unable to load Order Requests. Please retry.'
        )
        setLoading(false)
      }
    }
  }, [conversationId, scope])
  useEffect(() => {
    generation.current++
    const invalidate = () => {
      generation.current++
    }
    setHistory(null)
    accepted.current.clear()
    setPendingAcceptanceIds([])
    setError('')
    setLoading(enabled)
    if (!enabled) return undefined
    refresh().catch(() => {})
    const changed = (event: Event) => {
      const detail = (event as CustomEvent<{ conversationId?: string }>).detail
      if (!detail?.conversationId || detail.conversationId === conversationId)
        refresh().catch(() => {})
    }
    const recover = () => refresh().catch(() => {})
    window.addEventListener('marketplace-request-invalidated', changed)
    window.addEventListener('focus', recover)
    return () => {
      invalidate()
      window.removeEventListener('marketplace-request-invalidated', changed)
      window.removeEventListener('focus', recover)
    }
  }, [conversationId, currentUserId, enabled, refresh])
  return {
    history,
    loading,
    error,
    refresh,
    pendingAcceptanceIds,
    markAcceptanceSucceeded,
    isAcceptanceBlocked,
  }
}
