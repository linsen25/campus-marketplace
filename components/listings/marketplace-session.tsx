import { useRouter } from 'next/router'
import type { ReactNode } from 'react'
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
} from 'react'

import { marketplaceRequest } from '@/lib/listings-api'
import type { SellerSummary } from '@/types/listing'

type MarketplaceSession = {
  seller: SellerSummary | null
  loading: boolean
  error: string
  refresh: () => Promise<SellerSummary | null>
}

const initialSession: MarketplaceSession = {
  seller: null,
  loading: true,
  error: '',
  refresh: () => Promise.resolve(null),
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
  const requestVersion = useRef(0)
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current
    const data = await marketplaceRequest<{ seller: SellerSummary | null }>(
      '/api/auth/session',
      'GET'
    )
    if (version === requestVersion.current)
      setState({
        ...initialSession,
        seller: data.seller,
        loading: false,
        path: asPath,
      })
    return data.seller
  }, [asPath])
  useEffect(() => {
    let active = true
    const version = ++requestVersion.current
    setState({ ...initialSession, path: asPath })
    marketplaceRequest<{ seller: SellerSummary | null }>(
      '/api/auth/session',
      'GET'
    )
      .then((data) => {
        if (active && version === requestVersion.current)
          setState({
            ...initialSession,
            seller: data.seller,
            loading: false,
            error: '',
            path: asPath,
          })
      })
      .catch(() => {
        if (active && version === requestVersion.current)
          setState({
            ...initialSession,
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
    <SessionContext.Provider value={{ ...session, refresh }}>
      {children}
    </SessionContext.Provider>
  )
}

export function useMarketplaceSession() {
  return useContext(SessionContext)
}
