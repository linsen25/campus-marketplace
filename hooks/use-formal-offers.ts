import { useCallback, useEffect, useRef, useState } from 'react'

import { getOffers } from '@/lib/offers-api'
import type { OfferHistory } from '@/lib/offers-api'
import type { Offer } from '@/types/offer'

export function useFormalOffers(
  conversationId: string,
  userId: string,
  enabled: boolean
) {
  const [history, setHistory] = useState<OfferHistory | null>(null)
  const [error, setError] = useState('')
  const [blocked, setBlocked] = useState(false)
  const scope = `${userId}:${conversationId}`
  const current = useRef(scope)
  current.current = scope
  const serial = useRef(0)
  // Mutation receipts are barriers only; rows/statuses always come from history.
  const receipt = useRef<Offer | null>(null)
  const accepted = useRef<{ id: string; orderId: string } | null>(null)
  const markAcceptSucceeded = (id: string, orderId: string) => {
    if (current.current !== scope) return
    serial.current++
    accepted.current = { id, orderId }
    setBlocked(true)
  }
  const markSucceeded = (offer: Offer) => {
    if (current.current !== scope) return
    serial.current++
    receipt.current = offer
    setBlocked(true)
  }
  const refresh = useCallback(async () => {
    if (!enabled || current.current !== scope) return
    const read = ++serial.current
    try {
      const result = await getOffers(conversationId)
      if (read !== serial.current || current.current !== scope) return
      setHistory(result)
      const acceptance = accepted.current
      if (
        acceptance &&
        !result.offers.some(
          (row) =>
            row.id === acceptance.id &&
            row.status === 'Accepted' &&
            row.linkedOrderId === acceptance.orderId
        )
      ) {
        setError(
          'Offer accepted. Actions remain unavailable until refresh confirms the Order. Retry refresh.'
        )
        return
      }
      accepted.current = null
      const expected = receipt.current
      const row =
        expected && result.offers.find((item) => item.id === expected.id)
      // A later authoritative terminal result is also valid; an older Active is not.
      if (
        expected &&
        (!row || Date.parse(row.updatedAt) < Date.parse(expected.updatedAt))
      ) {
        setError(
          'Offer sent, but the latest state is still being confirmed. Retry refresh.'
        )
        return
      }
      receipt.current = null
      setBlocked(false)
      setError('')
    } catch {
      if (read === serial.current && current.current === scope)
        setError(
          receipt.current || accepted.current
            ? 'Offer saved. Actions remain unavailable until refresh succeeds. Please retry.'
            : 'Unable to load Offers. Please retry.'
        )
    }
  }, [conversationId, enabled, scope])
  useEffect(() => {
    serial.current++
    receipt.current = null
    accepted.current = null
    setHistory(null)
    setBlocked(false)
    setError('')
    if (!enabled) return undefined
    refresh().catch(() => {})
    const changed = (event: Event) => {
      const id = (event as CustomEvent<{ conversationId?: string }>).detail
        ?.conversationId
      if (!id || id === conversationId) refresh().catch(() => {})
    }
    const recover = () => refresh().catch(() => {})
    window.addEventListener('marketplace-request-invalidated', changed)
    window.addEventListener('focus', recover)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- This is an async generation counter, not a DOM ref.
      serial.current++
      window.removeEventListener('marketplace-request-invalidated', changed)
      window.removeEventListener('focus', recover)
    }
  }, [conversationId, enabled, refresh, userId])
  return {
    history,
    error,
    blocked,
    loading: enabled && !history && !error,
    refresh,
    markSucceeded,
    markAcceptSucceeded,
    isBlocked: () => receipt.current !== null || accepted.current !== null,
  }
}
