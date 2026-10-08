/* eslint-disable @typescript-eslint/no-use-before-define -- Token, recovery and teardown callbacks share one scoped lifecycle. */
import { createClient } from '@supabase/supabase-js'

export type MessagesSignal = {
  conversationId: string
  role: 'buying' | 'selling'
  scope: 'history' | 'list'
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i
let teardown: Promise<unknown> = Promise.resolve()

export function parseMessagesSignal(value: unknown): MessagesSignal | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  if (
    Object.keys(item).some(
      (key) => !['conversationId', 'role', 'scope', 'id'].includes(key)
    ) ||
    typeof item.conversationId !== 'string' ||
    !uuid.test(item.conversationId) ||
    !['buying', 'selling'].includes(String(item.role)) ||
    !['history', 'list'].includes(String(item.scope))
  )
    return null
  return item as MessagesSignal
}

// A mounted Messages owner holds the token only in this closure. No browser Auth client.
export function connectMessagesRealtime(
  userId: string,
  onSignal: (signal: MessagesSignal) => void,
  recover: () => void,
  unauthenticated: () => void
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || ''
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const projects: Record<string, string> = {
    staging: 'pcaqxezdfxofysghssyo',
    production: 'yzvchumzyonegujucyqs',
  }
  const designation = process.env.NEXT_PUBLIC_MESSAGES_ENV || ''
  const ref = Object.prototype.hasOwnProperty.call(projects, designation)
    ? projects[designation]
    : undefined
  let supported = false
  try {
    const target = new URL(url)
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
    if (!publicKey) {
      const claims = JSON.parse(
        atob(key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))
      )
      publicKey = claims.role === 'anon' && claims.ref === ref
    }
    supported =
      typeof window !== 'undefined' &&
      Boolean(ref) &&
      uuid.test(userId) &&
      publicKey &&
      target.origin === `https://${ref}.supabase.co` &&
      target.pathname === '/' &&
      !target.search &&
      !target.hash &&
      !target.username &&
      !target.password
  } catch {
    supported = false
  }
  // Unknown or mismatched build/project configurations never start a connection.
  if (!supported) return () => {}
  let stopped = false
  let token: { accessToken: string; expiresAt: number; userId: string } | null =
    null
  let pending: Promise<string> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let client: ReturnType<typeof createClient> | undefined
  let refreshing: Promise<void> | undefined
  let starting: Promise<void> | undefined
  const getToken = (force = false): Promise<string> => {
    if (stopped) throw new Error('Connection closed.')
    if (!force && token && token.expiresAt * 1000 > Date.now() + 60000)
      return Promise.resolve(token.accessToken)
    if (!pending)
      pending = (async () => {
        const response = await fetch('/api/messages/realtime-session', {
          method: 'POST',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-Marketplace-Request': '1',
          },
          body: '{}',
        })
        if (!response.ok) {
          if ([401, 403].includes(response.status)) {
            stop()
            unauthenticated()
          }
          throw new Error('Messages connection unavailable.')
        }
        const next = await response.json()
        if (
          stopped ||
          next.userId !== userId ||
          !uuid.test(next.userId) ||
          typeof next.accessToken !== 'string' ||
          !Number.isFinite(next.expiresAt) ||
          next.expiresAt * 1000 <= Date.now()
        ) {
          if (!stopped) {
            stop()
            unauthenticated()
          }
          throw new Error('Connection session changed.')
        }
        token = next
        if (timer) clearTimeout(timer)
        timer = setTimeout(
          () => resume(),
          Math.max(1000, next.expiresAt * 1000 - Date.now() - 60000)
        )
        return next.accessToken
      })().finally(() => {
        pending = undefined
      })
    return pending
  }
  const resume = async () => {
    if (
      stopped ||
      refreshing ||
      document.visibilityState === 'hidden' ||
      !navigator.onLine
    )
      return
    refreshing = (async () => {
      try {
        await getToken(true)
        if (stopped) return
        if (!client) await start()
        await client?.realtime.setAuth()
        if (!stopped) recover()
      } catch {
        // API messaging stays usable; retry the optional connection without logging tokens.
        if (!stopped) {
          if (timer) clearTimeout(timer)
          timer = setTimeout(() => resume(), 5000)
        }
      }
    })().finally(() => {
      refreshing = undefined
    })
    await refreshing
  }
  const stop = () => {
    if (stopped) return
    stopped = true
    token = null
    if (timer) clearTimeout(timer)
    window.removeEventListener('online', resume)
    window.removeEventListener('focus', resume)
    window.removeEventListener('marketplace-session-ended', ended)
    window.removeEventListener('storage', storage)
    document.removeEventListener('visibilitychange', resume)
    const owned = client
    teardown = teardown
      .then(async () => {
        await owned?.removeAllChannels()
        owned?.realtime.disconnect()
      })
      .catch(() => {})
  }
  const ended = () => {
    stop()
    unauthenticated()
  }
  const storage = (event: StorageEvent) => {
    if (event.key === 'marketplace-session-ended') {
      stop()
      unauthenticated()
    }
  }
  window.addEventListener('online', resume)
  window.addEventListener('focus', resume)
  window.addEventListener('marketplace-session-ended', ended)
  window.addEventListener('storage', storage)
  document.addEventListener('visibilitychange', resume)
  function start(): Promise<void> {
    if (stopped || client) return Promise.resolve()
    if (starting) return starting
    starting = teardown
      .then(async () => {
        try {
          await getToken()
          if (stopped) return
          client = createClient(url, key, {
            accessToken: () => getToken(),
            realtime: {
              sessionStorage: {
                length: 0,
                key: () => null,
                clear: () => {},
                getItem: () => null,
                setItem: () => {},
                removeItem: () => {},
              },
            },
          })
          await client.realtime.setAuth()
          if (stopped) {
            await client.removeAllChannels()
            client.realtime.disconnect()
            return
          }
          client
            .channel(`marketplace:messages:${userId}`, {
              config: { private: true },
            })
            .on('broadcast', { event: 'messages_changed' }, (event) => {
              if (stopped) return
              const signal = parseMessagesSignal(event.payload)
              if (signal) onSignal(signal)
            })
            .subscribe((status) => {
              if (stopped) return
              if (status === 'SUBSCRIBED') recover()
              else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) resume()
            })
        } catch {
          if (!stopped) {
            timer = setTimeout(() => {
              start().catch(() => {})
            }, 5000)
          }
        }
      })
      .finally(() => {
        starting = undefined
      })
    return starting
  }
  start().catch(() => {})
  return stop
}
