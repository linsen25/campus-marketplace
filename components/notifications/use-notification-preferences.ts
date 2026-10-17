import { useCallback, useEffect, useRef, useState } from 'react'

import { marketplaceRequest } from '@/lib/listings-api'
import {
  notificationPreferenceKeys,
  validNotificationPreferences,
} from '@/lib/notification-preferences'
import type { NotificationPreferences } from '@/lib/notification-preferences'

export function useNotificationPreferences(userId: string | undefined) {
  const actor = useRef(userId)
  actor.current = userId
  const generation = useRef(0)
  const live = useRef(false)
  const session = useRef(0)
  const busy = useRef({ inApp: false, sounds: false, email: false })
  const revisions = useRef({ inApp: 0, sounds: 0, email: 0 })
  const confirmed = useRef<NotificationPreferences | null>(null)
  const intent = useRef<NotificationPreferences | null>(null)
  const [saved, setSaved] = useState<{
    owner: string
    data: NotificationPreferences
  } | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(busy.current)
  const [saveErrors, setSaveErrors] = useState({
    inApp: '',
    sounds: '',
    email: '',
  })
  const refresh = useCallback(async () => {
    const owner = actor.current
    const request = ++generation.current
    const versions = { ...revisions.current }
    if (!owner) return
    try {
      const data = await marketplaceRequest<NotificationPreferences>(
        '/api/notification-preferences',
        'GET'
      )
      if (!validNotificationPreferences(data))
        throw new Error('Invalid preferences')
      if (
        live.current &&
        actor.current === owner &&
        request === generation.current
      ) {
        setSaved((previous) => {
          if (!previous || previous.owner !== owner) {
            confirmed.current = { ...data }
            intent.current = { ...data }
            return { owner, data }
          }
          const merged = { ...previous.data }
          for (const key of notificationPreferenceKeys)
            if (
              !busy.current[key] &&
              versions[key] === revisions.current[key]
            ) {
              merged[key] = data[key]
              if (confirmed.current) confirmed.current[key] = data[key]
              if (intent.current) intent.current[key] = data[key]
            }
          return { owner, data: merged }
        })
        setError('')
      }
    } catch {
      if (
        live.current &&
        actor.current === owner &&
        request === generation.current
      )
        setError('Unable to load notification preferences. Please retry.')
    }
  }, [])
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  useEffect(() => {
    live.current = Boolean(userId)
    setSaved(null)
    confirmed.current = null
    intent.current = null
    setError('')
    const currentSession = ++session.current
    busy.current = { inApp: false, sounds: false, email: false }
    setPending(busy.current)
    setSaveErrors({ inApp: '', sounds: '', email: '' })
    refresh()
    return () => {
      live.current = false
      session.current = currentSession + 1
      invalidate()
    }
  }, [userId, refresh, invalidate])
  async function save(key: keyof NotificationPreferences, value: boolean) {
    const owner = actor.current
    if (!owner || !live.current || !intent.current || !confirmed.current) return
    const currentSession = session.current
    intent.current[key] = value
    revisions.current[key]++
    setSaved((previous) =>
      previous && previous.owner === owner
        ? { owner, data: { ...previous.data, [key]: value } }
        : previous
    )
    setSaveErrors((previous) => ({ ...previous, [key]: '' }))
    if (busy.current[key]) return
    busy.current = { ...busy.current, [key]: true }
    setPending(busy.current)
    const isCurrent = () =>
      live.current &&
      actor.current === owner &&
      currentSession === session.current
    try {
      // Serialize writes for this key so server execution cannot reverse intent.
      // Other keys have independent queues; intermediate toggles coalesce.
      while (isCurrent() && intent.current && confirmed.current) {
        const version = revisions.current[key]
        const next = intent.current[key]
        try {
          const data = await marketplaceRequest<NotificationPreferences>(
            '/api/notification-preferences',
            'POST',
            { key, value: next }
          )
          if (!validNotificationPreferences(data))
            throw new Error('Invalid preferences')
          if (!isCurrent()) return
          confirmed.current[key] = data[key]
          if (version === revisions.current[key]) {
            intent.current[key] = data[key]
            setSaved((previous) =>
              previous && previous.owner === owner
                ? { owner, data: { ...previous.data, [key]: data[key] } }
                : previous
            )
          }
        } catch {
          if (!isCurrent()) return
          if (version === revisions.current[key]) {
            const rollback = confirmed.current[key]
            intent.current[key] = rollback
            setSaved((previous) =>
              previous && previous.owner === owner
                ? { owner, data: { ...previous.data, [key]: rollback } }
                : previous
            )
            setSaveErrors((previous) => ({
              ...previous,
              [key]: 'Unable to save this preference. Please retry.',
            }))
          }
        }
        if (version === revisions.current[key]) break
      }
    } finally {
      if (isCurrent()) {
        revisions.current[key]++
        busy.current = { ...busy.current, [key]: false }
        setPending(busy.current)
      }
    }
  }
  return {
    data: saved && saved.owner === userId ? saved.data : null,
    error,
    pending,
    saveErrors,
    refresh,
    save,
  }
}
