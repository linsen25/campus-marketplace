import { useEffect, useRef, useState } from 'react'

import { getListing, marketplaceRequest } from '@/lib/listings-api'
import type { ListingStatus } from '@/types/listing'

import { useMarketplaceSession } from './marketplace-session'
import { useMessageSeller } from './use-message-seller'

type Context = {
  activeOfferId: string | null
  orderId: string | null
  hasHistory: boolean
  available: boolean
}
function blockedReason(context: Context, status: ListingStatus | undefined) {
  if (status === 'sold') return 'This listing has been sold.'
  if (context.orderId || status === 'pending' || status === 'reserved')
    return 'An order is already in progress for this listing.'
  if (!context.available || status !== 'available')
    return 'This listing is no longer available for new offers.'
  return ''
}
export function useListingOfferContext(
  listingId: string,
  sellerId: string,
  allowed = true
) {
  const { seller } = useMarketplaceSession()
  const messaging = useMessageSeller(listingId)
  const [context, setContext] = useState<Context | null>(null)
  const [error, setError] = useState('')
  const [status, setStatus] = useState<ListingStatus>()
  const [checking, setChecking] = useState(false)
  const opening = useRef(false)
  const enabled =
    allowed &&
    Boolean(seller && seller.id !== sellerId) &&
    process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co'
  useEffect(() => {
    let valid = true
    setContext(null)
    setError('')
    setStatus(undefined)
    if (!enabled) return undefined
    const refresh = () =>
      Promise.all([
        marketplaceRequest<Context>(
          `/api/offers?listingId=${encodeURIComponent(listingId)}`,
          'GET'
        ),
        getListing(listingId),
      ])
        .then(([result, listing]) => {
          if (valid) {
            setContext(result)
            setStatus(listing?.status)
            setError('')
          }
        })
        .catch(() => {
          if (valid) setError('Unable to check Offers. Please retry.')
        })
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('marketplace-request-invalidated', refresh)
    window.addEventListener('marketplace-listings-changed', refresh)
    return () => {
      valid = false
      window.removeEventListener('focus', refresh)
      window.removeEventListener('marketplace-request-invalidated', refresh)
      window.removeEventListener('marketplace-listings-changed', refresh)
    }
  }, [enabled, listingId, seller?.id])
  let label = 'Make Offer'
  if (context?.hasHistory) label = 'Make New Offer'
  if (context?.activeOfferId) label = 'Revise Offer'
  const reason =
    error ||
    (context ? blockedReason(context, status) : 'Checking offer availability.')
  if (reason) label = 'Make Offer'
  const open = async () => {
    if (!enabled || reason || messaging.busy) return
    if (opening.current) return
    opening.current = true
    setChecking(true)
    try {
      const [current, listing] = await Promise.all([
        marketplaceRequest<Context>(
          `/api/offers?listingId=${encodeURIComponent(listingId)}`,
          'GET'
        ),
        getListing(listingId),
      ])
      setContext(current)
      setStatus(listing?.status)
      if (!blockedReason(current, listing?.status))
        await messaging.contact(true)
    } catch {
      setError('Unable to check Offers. Please retry.')
    } finally {
      opening.current = false
      setChecking(false)
    }
  }
  return {
    enabled,
    label,
    open,
    orderId: context?.orderId,
    busy: checking || messaging.busy || (enabled && !context && !error),
    error: error || messaging.error,
    disabled: Boolean(reason),
    reason,
  }
}
