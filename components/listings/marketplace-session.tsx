import { useRouter } from 'next/router'
import type { ReactNode } from 'react'
import { createContext, useContext, useEffect, useState } from 'react'

import { marketplaceRequest } from '@/lib/listings-api'
import type { SellerSummary } from '@/types/listing'

type MarketplaceSession = {
  seller: SellerSummary | null
  loading: boolean
  error: string
}

const initialSession: MarketplaceSession = {
  seller: null,
  loading: true,
  error: '',
}
const SessionContext = createContext(initialSession)

// Share the existing account session lookup with the navigation, rather than
// making a second auth request or inferring authentication from the route.
export function MarketplaceSessionProvider({
  children,
}: {
  children: ReactNode
}) {
  const { asPath } = useRouter()
  const [state, setState] = useState({ ...initialSession, path: asPath })
  useEffect(() => {
    let active = true
    setState({ ...initialSession, path: asPath })
    marketplaceRequest<{ seller: SellerSummary | null }>(
      '/api/auth/session',
      'GET'
    )
      .then((data) => {
        if (active)
          setState({
            seller: data.seller,
            loading: false,
            error: '',
            path: asPath,
          })
      })
      .catch(() => {
        if (active)
          setState({
            seller: null,
            loading: false,
            error: 'Unable to load your account. Please refresh to try again.',
            path: asPath,
          })
      })
    return () => {
      active = false
    }
  }, [asPath])
  const session = state.path === asPath ? state : initialSession
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  )
}

export function useMarketplaceSession() {
  return useContext(SessionContext)
}
