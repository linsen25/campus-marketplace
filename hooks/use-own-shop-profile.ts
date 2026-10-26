import { useCallback, useEffect, useRef, useState } from 'react'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import type { ShopIdentity } from '@/lib/shop-presentation'
import {
  requestOwnShop,
  createOwnShop,
  shopIdentityPatch,
  ShopProfileError,
} from '@/lib/shop-profile-api'
import type { ShopProfileResult } from '@/lib/shop-profile-api'

type Status = 'absent' | 'anonymous' | 'error' | 'loading' | 'ready'
export type ShopApplicationStatus = 'none' | 'pending' | 'approved' | 'rejected'
type State = ShopProfileResult & {
  ownerId?: string
  status: Status
  error: string
  applicationStatus: ShopApplicationStatus
}
const empty: State = {
  shop: null,
  etag: null,
  status: 'loading',
  error: '',
  applicationStatus: 'none',
}
const conflict =
  'Your Shop changed elsewhere. Close and reopen this editor to review the latest information.'

/** One instance above the responsive Settings branches; no membership gate/cache. */
export function useOwnShopProfile(enabled: boolean) {
  const { seller, loading, error: sessionError } = useMarketplaceSession()
  const ownerId = seller?.id
  const scope = `${enabled}:${ownerId || ''}:${loading}:${sessionError}`
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const generation = useRef(0)
  const request = useRef(0)
  const busy = useRef(false)
  const ended = useRef(false)
  const uncertain = useRef(false)
  const confirmed = useRef<ShopProfileResult | null>(null)
  const [state, setState] = useState<State>(empty)

  const valid = useCallback(
    (result: ShopProfileResult) => {
      if (result.shop && (result.shop.ownerId !== ownerId || !result.etag))
        throw new ShopProfileError(
          'Unable to load Shop settings. Reopen Settings to retry.',
          503
        )
      return result
    },
    [ownerId]
  )

  const refresh = useCallback(async () => {
    if (!enabled || !ownerId || loading || busy.current || ended.current) return
    const epoch = generation.current
    const serial = ++request.current
    const current = () =>
      epoch === generation.current &&
      serial === request.current &&
      scopeRef.current === scope
    try {
      const result = valid(await requestOwnShop())
      let applicationStatus: ShopApplicationStatus = 'none'
      try {
        const application = await fetch('/api/shop/application', {
          credentials: 'same-origin',
          cache: 'no-store',
        })
        if (application.ok) {
          const value = (await application.json()).status
          if (['none', 'pending', 'approved', 'rejected'].includes(value))
            applicationStatus = value
        }
      } catch {}
      if (!current()) return
      confirmed.current = result
      setState({
        ...result,
        ownerId,
        status: result.shop ? 'ready' : 'absent',
        error: '',
        applicationStatus,
      })
    } catch (error) {
      if (!current()) return
      if (error instanceof ShopProfileError && error.status === 401)
        confirmed.current = null
      setState({
        ...(confirmed.current || empty),
        ownerId,
        status:
          error instanceof ShopProfileError && error.status === 401
            ? 'anonymous'
            : 'error',
        error: 'Unable to load Shop settings. Reopen Settings to retry.',
        applicationStatus: confirmed.current ? 'approved' : 'none',
      })
    }
  }, [enabled, ownerId, loading, scope, valid])

  useEffect(() => {
    generation.current++
    busy.current = false
    ended.current = false
    uncertain.current = false
    confirmed.current = null
    setState(empty)
    refresh().catch(() => {})
    const focus = () => {
      refresh().catch(() => {})
    }
    const clear = () => {
      generation.current++
      request.current++
      ended.current = true
      confirmed.current = null
      setState({ ...empty, ownerId, status: 'anonymous' })
    }
    window.addEventListener('focus', focus)
    window.addEventListener('marketplace-session-ended', clear)
    const invalidate = () => {
      generation.current++
      request.current++
    }
    return () => {
      invalidate()
      window.removeEventListener('focus', focus)
      window.removeEventListener('marketplace-session-ended', clear)
    }
  }, [refresh, ownerId])

  const save = useCallback(
    // eslint-disable-next-line complexity -- One owner-scoped write includes conflict, uncertain-response and expired-session recovery, without automatic replay.
    async (identity: Partial<ShopIdentity>, base?: string) => {
      const epoch = generation.current
      const current = () =>
        epoch === generation.current && scopeRef.current === scope
      if (
        !enabled ||
        !ownerId ||
        loading ||
        ended.current ||
        !base ||
        !confirmed.current?.shop ||
        !current()
      )
        throw new ShopProfileError('Log in to manage your Shop.', 401)
      if (busy.current) throw new Error('A Shop change is already saving.')
      busy.current = true
      request.current++ // invalidate a GET that started before this save
      const patch = shopIdentityPatch(identity)
      const accept = (result: ShopProfileResult) => {
        if (!current())
          throw new ShopProfileError(
            'Your session changed. Reopen Settings to continue.',
            401
          )
        valid(result)
        confirmed.current = result
        setState({
          ...result,
          ownerId,
          status: result.shop ? 'ready' : 'absent',
          error: '',
          applicationStatus: 'approved',
        })
      }
      const reconcile = async () => {
        try {
          const result = await requestOwnShop()
          accept(result)
          uncertain.current = false
          return result
        } catch (error) {
          if (
            current() &&
            error instanceof ShopProfileError &&
            error.status === 401
          ) {
            confirmed.current = null
            setState({ ...empty, ownerId, status: 'anonymous' })
          }
          throw error
        }
      }
      const matches = (result: ShopProfileResult) =>
        Boolean(
          result.shop &&
            Object.entries(patch).every(
              ([key, value]) =>
                result.shop?.[key as keyof typeof patch] === value?.trim()
            )
        )
      try {
        if (uncertain.current) {
          const result = await reconcile()
          if (matches(result)) return
          if (result.etag !== base) throw new ShopProfileError(conflict, 409)
        }
        if (confirmed.current?.etag !== base)
          throw new ShopProfileError(conflict, 409)
        accept(await requestOwnShop(patch, base))
      } catch (error) {
        if (!current())
          throw new ShopProfileError(
            'Your session changed. Reopen Settings to continue.',
            401
          )
        if (error instanceof ShopProfileError && error.status === 401) {
          confirmed.current = null
          setState({ ...empty, ownerId, status: 'anonymous' })
        } else if (error instanceof ShopProfileError && error.status === 409) {
          try {
            await reconcile()
          } catch {
            /* Preserve input; never replay a conflict. */
          }
        } else if (
          !(error instanceof ShopProfileError) ||
          error.status >= 500
        ) {
          uncertain.current = true
          try {
            if (matches(await reconcile())) return
          } catch {
            /* Uncertain writes must reconcile before the next retry. */
          }
        }
        throw error
      } finally {
        if (current()) busy.current = false
      }
    },
    [enabled, ownerId, loading, scope, valid]
  )

  const create = useCallback(
    async (identity: import('@/types/shop').CreateShopProfileInput) => {
      if (!enabled || !ownerId || loading || ended.current)
        throw new ShopProfileError('Log in to manage your Shop.', 401)
      const result = valid(await createOwnShop(identity))
      if (result.shop && result.shop.ownerId !== ownerId)
        throw new ShopProfileError('Unable to load Shop settings.', 503)
      confirmed.current = result
      setState({
        ...result,
        ownerId,
        status: result.shop ? 'ready' : 'absent',
        error: '',
        applicationStatus: 'approved',
      })
      return result
    },
    [enabled, ownerId, loading, valid]
  )

  const visible =
    enabled && ownerId && state.ownerId === ownerId ? state : empty
  let status: Status = visible.status
  if (!enabled || loading) status = 'loading'
  else if (sessionError) status = 'error'
  else if (!ownerId) status = 'anonymous'
  const result: Omit<State, 'status'> & {
    status: Status
    save: typeof save
    create: typeof create
  } = {
    ...visible,
    status,
    save,
    create,
  }
  return result
}

export type OwnShopProfile = ReturnType<typeof useOwnShopProfile>
