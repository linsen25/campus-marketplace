import { useCallback, useEffect, useRef, useState } from 'react'

import type { NotificationItem } from '@/lib/notification-category'

import { useNotificationSound } from './use-notification-sound'

// IDs only; preserve dedupe across a same-account Provider remount, never across logout.
const recent = new Map<string, Set<string>>()
export function realtimeNotification(value: unknown): NotificationItem | null {
  if (!value || typeof value !== 'object') return null
  const signal = value as Record<string, unknown>
  if (
    signal.inserted !== true ||
    !signal.notification ||
    typeof signal.notification !== 'object'
  )
    return null
  const n = signal.notification as Record<string, unknown>
  if (
    typeof n.id !== 'string' ||
    !/^[a-f0-9-]{36}$/i.test(n.id) ||
    typeof n.event_type !== 'string' ||
    n.event_type.length > 100 ||
    typeof n.created_at !== 'string' ||
    !Number.isFinite(Date.parse(n.created_at)) ||
    n.read_at !== null ||
    !n.destination ||
    typeof n.destination !== 'object' ||
    Array.isArray(n.destination)
  )
    return null
  return {
    id: n.id,
    event_type: n.event_type,
    created_at: n.created_at,
    read_at: null,
    destination: n.destination as Record<string, unknown>,
  }
}
export function useNotificationPopups(
  userId: string | undefined,
  enabled: boolean,
  sounds = false
) {
  const { play: playSound, stop: stopSound } = useNotificationSound(
    userId,
    enabled && sounds
  )
  const actor = useRef(userId)
  actor.current = userId
  const allowed = useRef(enabled)
  allowed.current = enabled
  const ready = useRef(false)
  const live = useRef(false)
  const [items, setItems] = useState<NotificationItem[]>([])
  const remember = useCallback((id: string) => {
    const owner = actor.current
    if (!owner) return false
    const seen = recent.get(owner) || new Set<string>()
    recent.set(owner, seen)
    const existed = seen.has(id)
    seen.add(id)
    if (seen.size > 1000) seen.delete(seen.values().next().value)
    return existed
  }, [])
  const hydrate = useCallback(
    (rows: NotificationItem[]) => {
      rows.forEach((n) => remember(n.id))
      ready.current = true
    },
    [remember]
  )
  const clear = useCallback(() => {
    stopSound()
    ready.current = false
    setItems([])
  }, [stopSound])
  useEffect(() => {
    live.current = Boolean(userId)
    ready.current = false
    setItems([])
    return () => {
      live.current = false
      ready.current = false
    }
  }, [userId])
  useEffect(() => {
    if (!enabled) setItems([])
  }, [enabled])
  const receive = useCallback(
    async (value: unknown, refresh: () => Promise<void>) => {
      const owner = actor.current
      const item = realtimeNotification(value)
      const duplicate = item ? remember(item.id) : true
      const show = item && ready.current && allowed.current && !duplicate
      await refresh()
      if (show && live.current && actor.current === owner && allowed.current) {
        setItems((current) =>
          [...current.filter((n) => n.id !== item.id), item].slice(-20)
        )
        playSound()
      }
    },
    [remember, playSound]
  )
  const dismiss = useCallback(
    (id: string) => setItems((current) => current.filter((n) => n.id !== id)),
    []
  )
  const logout = useCallback(() => {
    live.current = false
    if (actor.current) recent.delete(actor.current)
    clear()
  }, [clear])
  return { items, hydrate, receive, dismiss, logout }
}
