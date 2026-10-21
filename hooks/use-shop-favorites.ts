import { atom } from 'jotai'
import { useAtomValue } from 'jotai/utils'
import { useEffect, useSyncExternalStore } from 'react'

import { useAuthModal } from '@/components/auth/auth-modal'
import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import {
  readShopFavoriteStates,
  shopUuid,
  writeShopFavorite,
} from '@/lib/shop-favorites-api'

type State = {
  liked: boolean
  known: boolean
  loading: boolean
  pending: boolean
  error: string
  version: number
  uncertain: boolean
}
const empty = (): State => ({
  liked: false,
  known: false,
  loading: true,
  pending: false,
  error: '',
  version: 0,
  uncertain: false,
})

// One resource per existing Jotai provider. No new provider, storage or event bus.
export function createShopFavoritesCache() {
  let actor = ''
  let generation = 0
  let revision = 0
  let listRevision = 0
  let queued = false
  const states = new Map<string, State>()
  const waiting = new Set<string>()
  const listeners = new Set<() => void>()
  const publish = () => {
    revision += 1
    listeners.forEach((fn) => fn())
  }
  const bind = (id: string) => {
    if (actor === id) return
    actor = id
    generation += 1
    states.clear()
    waiting.clear()
    listRevision += 1
    publish()
  }
  function schedule() {
    if (!queued) {
      queued = true
      queueMicrotask(flush)
    }
  }
  async function flush() {
    queued = false
    const ids = Array.from(waiting).slice(0, 100)
    ids.forEach((id) => waiting.delete(id))
    if (!ids.length || !actor) return
    const epoch = generation
    const versions = ids.map((id) => states.get(id)?.version)
    try {
      const result = await readShopFavoriteStates(ids)
      if (epoch !== generation) return
      ids.forEach((id, index) => {
        const current = states.get(id)
        if (current && current.version === versions[index])
          states.set(id, {
            ...current,
            liked: result.favoriteShopIds.includes(id),
            known: true,
            loading: false,
            uncertain: false,
            error: '',
          })
      })
    } catch {
      if (epoch !== generation) return
      ids.forEach((id, index) => {
        const current = states.get(id)
        if (current && current.version === versions[index])
          states.set(id, {
            ...current,
            loading: false,
            error: 'Could not load Shop favorites. Please retry.',
          })
      })
    }
    if (epoch === generation) {
      publish()
      if (waiting.size) schedule()
    }
  }
  const load = (id: string, force = false) => {
    if (!actor || !shopUuid.test(id)) return
    const current = states.get(id)
    if (current?.pending || (!force && current)) return
    states.set(id, {
      ...(current || empty()),
      loading: true,
      error: '',
      version: (current?.version || 0) + 1,
    })
    waiting.add(id)
    publish()
    schedule()
  }
  const change = async (id: string, enabled: boolean) => {
    const current = states.get(id)
    if (
      !actor ||
      !current?.known ||
      current.loading ||
      current.pending ||
      current.uncertain
    )
      return
    const epoch = generation
    const version = current.version + 1
    states.set(id, { ...current, pending: true, error: '', version })
    publish()
    let liked = current.liked
    let error = ''
    let uncertain = false
    try {
      const result = await writeShopFavorite(id, enabled)
      liked = result.favorited
    } catch {
      // An HTTP failure may have followed a committed write. Never replay it blindly.
      try {
        const result = await readShopFavoriteStates([id])
        liked = result.favoriteShopIds.includes(id)
        if (liked !== enabled)
          error = 'Could not update Shop favorite. Please retry.'
      } catch {
        uncertain = true
        error = 'Unable to confirm Shop favorite. Please retry.'
      }
    }
    if (epoch !== generation) return
    states.set(id, {
      ...current,
      liked,
      pending: false,
      error,
      version,
      uncertain,
    })
    listRevision += 1
    publish()
  }
  return {
    bind,
    load,
    change,
    state: (id: string) => states.get(id),
    actor: () => actor,
    listRevision: () => listRevision,
    snapshot: () => revision,
    subscribe: (fn: () => void) => {
      listeners.add(fn)
      return () => {
        listeners.delete(fn)
      }
    },
  }
}
const cacheAtom = atom(() => createShopFavoritesCache())

export function useShopFavoritesAccount() {
  const cache = useAtomValue(cacheAtom)
  const { seller } = useMarketplaceSession()
  const actor = seller?.id || ''
  useSyncExternalStore(cache.subscribe, cache.snapshot, () => 0)
  useEffect(() => {
    cache.bind(actor)
    const ended = () => cache.bind('')
    window.addEventListener('marketplace-session-ended', ended)
    return () => window.removeEventListener('marketplace-session-ended', ended)
  }, [actor, cache])
  return { actor, cache, listRevision: cache.listRevision() }
}

export function useShopFavorite(id?: string) {
  const { actor, cache } = useShopFavoritesAccount()
  const { openAuth } = useAuthModal()
  const valid = Boolean(id && shopUuid.test(id))
  useEffect(() => {
    if (!id || !valid) return undefined
    cache.load(id)
    const refresh = () => {
      if (document.visibilityState === 'visible') cache.load(id, true)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [actor, cache, id, valid])
  const state =
    actor && cache.actor() === actor && id ? cache.state(id) : undefined
  return {
    liked: state?.liked || false,
    disabled:
      !valid ||
      Boolean(
        actor &&
          (!state?.known || state.loading || state.pending || state.uncertain)
      ),
    error: state?.error || '',
    retry: () => {
      if (id) cache.load(id, true)
    },
    change: (enabled: boolean) => {
      if (!actor) {
        openAuth({ mode: 'signin', intent: 'login' })
        return
      }
      if (id && cache.actor() === actor) cache.change(id, enabled)
    },
  }
}
