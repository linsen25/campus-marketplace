import { useCallback, useEffect, useMemo, useState } from 'react'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import type { ShopMembership } from '@/types/shop-membership'

export type DevShopTier = 'plus' | 'pro'
type Simulation = { tier: DevShopTier; startedAt: string }

type MembershipState =
  | { status: 'loading'; membership: null; error: '' }
  | { status: 'ready'; membership: ShopMembership; error: '' }
  | {
      status: 'anonymous' | 'ineligible' | 'error'
      membership: null
      error: string
    }

const empty: MembershipState = {
  status: 'loading',
  membership: null,
  error: '',
}
const devOnly = process.env.NODE_ENV === 'development'

class ShopMembershipRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ShopMembershipRequestError'
  }
}

async function readMembership(): Promise<ShopMembership> {
  const response = await fetch('/api/shop/membership', {
    cache: 'no-store',
    credentials: 'same-origin',
    headers: { 'X-Marketplace-Request': '1' },
  })
  const body = await response.json().catch(() => null)
  if (!response.ok)
    throw new ShopMembershipRequestError(
      body?.error || 'Shop membership is unavailable. Please retry.',
      response.status
    )
  return body as ShopMembership
}

function storageKey(userId: string) {
  return `uu-v1:dev-shop-membership:${userId}`
}

function readSimulation(userId: string): Simulation | null {
  if (!devOnly || typeof window === 'undefined') return null
  try {
    const value = window.localStorage.getItem(storageKey(userId))
    if (value === 'plus' || value === 'pro')
      return { tier: value, startedAt: new Date().toISOString() }
    const parsed: unknown = value ? JSON.parse(value) : null
    if (
      parsed &&
      typeof parsed === 'object' &&
      ((parsed as Simulation).tier === 'plus' ||
        (parsed as Simulation).tier === 'pro') &&
      typeof (parsed as Simulation).startedAt === 'string'
    )
      return parsed as Simulation
    return null
  } catch {
    return null
  }
}

/**
 * Reads the server's membership projection without granting authority. A
 * development-only localStorage value may unlock presentation-only Shop demo
 * routes for the signed-in user; it never reaches an API, database, or payment
 * provider and cannot make a protected server action succeed.
 */
export function useShopMembershipAccess() {
  const { seller, loading: sessionLoading } = useMarketplaceSession()
  const userId = seller?.id ?? null
  const [state, setState] = useState<MembershipState>(empty)
  const [simulation, setSimulation] = useState<Simulation | null>(null)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    setSimulation(userId ? readSimulation(userId) : null)
  }, [userId])

  useEffect(() => {
    let active = true
    if (sessionLoading) {
      setState(empty)
      return () => {
        active = false
      }
    }
    if (!userId) {
      setState({ status: 'anonymous', membership: null, error: '' })
      return () => {
        active = false
      }
    }
    setState(empty)
    readMembership()
      .then((membership) => {
        if (active) setState({ status: 'ready', membership, error: '' })
      })
      .catch((reason) => {
        if (!active) return
        if (
          reason instanceof ShopMembershipRequestError &&
          reason.status === 403
        ) {
          setState({
            status: 'ineligible',
            membership: null,
            error: reason.message,
          })
          return
        }
        setState({
          status: 'error',
          membership: null,
          error:
            reason instanceof Error
              ? reason.message
              : 'Shop membership is unavailable. Please retry.',
        })
      })
    return () => {
      active = false
    }
  }, [sessionLoading, userId, revision])

  const simulate = useCallback(
    (tier: DevShopTier) => {
      if (!devOnly || !userId) return
      const next: Simulation = { tier, startedAt: new Date().toISOString() }
      try {
        window.localStorage.setItem(storageKey(userId), JSON.stringify(next))
        setSimulation(next)
      } catch {
        /* Development preview stays locked when local persistence is unavailable. */
      }
    },
    [userId]
  )
  const clearSimulation = useCallback(() => {
    if (!devOnly || !userId) return
    try {
      window.localStorage.removeItem(storageKey(userId))
    } catch {
      /* A blocked storage implementation cannot grant any UI access. */
    }
    setSimulation(null)
  }, [userId])
  const refresh = useCallback(() => setRevision((value) => value + 1), [])

  const realAccess = Boolean(state.membership?.canOperateShop)
  const access = realAccess || Boolean(simulation)
  return useMemo(
    () => ({
      userId,
      status: state.status,
      membership: state.membership,
      error: state.error,
      realAccess,
      simulation: devOnly ? simulation?.tier ?? null : null,
      simulationStartedAt: devOnly ? simulation?.startedAt ?? null : null,
      canAccessShopUi: access,
      devSimulationEnabled: devOnly,
      simulate,
      clearSimulation,
      refresh,
    }),
    [
      access,
      clearSimulation,
      realAccess,
      refresh,
      simulate,
      simulation,
      state.error,
      state.membership,
      state.status,
      userId,
    ]
  )
}
