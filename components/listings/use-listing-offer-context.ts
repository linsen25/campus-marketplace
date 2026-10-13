import { useRouter } from 'next/router'
import { useEffect, useState } from 'react'

import { marketplaceRequest } from '@/lib/listings-api'

import { useMarketplaceSession } from './marketplace-session'
import { useMessageSeller } from './use-message-seller'

type Context = {
  activeOfferId: string | null
  orderId: string | null
  hasHistory: boolean
  available: boolean
}
export function useListingOfferContext(listingId: string, sellerId: string) {
  const { seller } = useMarketplaceSession()
  const router = useRouter()
  const messaging = useMessageSeller(listingId)
  const [context, setContext] = useState<Context | null>(null)
  const [error, setError] = useState('')
  const enabled =
    Boolean(seller && seller.id !== sellerId) &&
    process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co'
  useEffect(() => {
    let valid = true
    setContext(null)
    setError('')
    if (!enabled) return undefined
    const refresh = () =>
      marketplaceRequest<Context>(
        `/api/offers?listingId=${encodeURIComponent(listingId)}`,
        'GET'
      )
        .then((result) => {
          if (valid) {
            setContext(result)
            setError('')
          }
        })
        .catch(() => {
          if (valid) setError('Unable to check Offers. Please retry.')
        })
    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('marketplace-request-invalidated', refresh)
    return () => {
      valid = false
      window.removeEventListener('focus', refresh)
      window.removeEventListener('marketplace-request-invalidated', refresh)
    }
  }, [enabled, listingId, seller?.id])
  let label = 'Make Offer'
  if (context?.hasHistory) label = 'Make New Offer'
  if (context?.activeOfferId) label = 'Revise Offer'
  if (context?.orderId) label = 'View Order'
  const open = () =>
    context?.orderId
      ? router
          .push({
            pathname: '/home',
            query: {
              section: 'orders',
              destination: 'purchases',
              order: context.orderId,
            },
          })
          .catch(() => {})
      : messaging.contact(true)
  return {
    enabled,
    label,
    open,
    orderId: context?.orderId,
    busy: messaging.busy || (enabled && !context && !error),
    error: error || messaging.error,
  }
}
