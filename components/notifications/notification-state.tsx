import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'

import { useMarketplaceSession } from '@/components/listings/marketplace-session'
import { marketplaceRequest } from '@/lib/listings-api'
import { connectMessagesRealtime } from '@/lib/messages-realtime'
import type {
  NotificationCategory,
  NotificationItem,
} from '@/lib/notification-category'

export type Feed = {
  notifications: NotificationItem[]
  unreadCount: number
  hasMore?: boolean
  nextCursor?: { before: string; beforeId: string } | null
}

const Context = createContext<ReturnType<typeof useNotificationState> | null>(
  null
)
export function useNotifications() {
  return useContext(Context)
}
function useNotificationState(userId: string | undefined) {
  const ownerRef = useRef(userId)
  ownerRef.current = userId
  const [owner, setOwner] = useState(userId)
  const [feed, setFeed] = useState<Feed>({ notifications: [], unreadCount: 0 })
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [more, setMore] = useState(false)
  const [category, setCategoryState] = useState<NotificationCategory | ''>('')
  const categoryRef = useRef<NotificationCategory | ''>('')
  const [status, setStatusState] = useState<'' | 'read' | 'unread'>('unread')
  const statusRef = useRef<'' | 'read' | 'unread'>('unread')
  const pagesLoaded = useRef(1)
  const version = useRef(0)
  const mounted = useRef(false)
  const refresh = useCallback(async () => {
    const request = ++version.current
    if (mounted.current) setRefreshing(true)
    try {
      const params = new URLSearchParams()
      if (categoryRef.current) params.set('category', categoryRef.current)
      if (statusRef.current) params.set('status', statusRef.current)
      let data: Feed = { notifications: [], unreadCount: 0 }
      const notifications: NotificationItem[] = []
      let hasMore = false
      // Revalidate the loaded window, retaining its authoritative continuation.
      for (let page = 0; page < pagesLoaded.current; page++) {
        data = await marketplaceRequest<Feed>(
          `/api/notifications${params.toString() ? `?${params}` : ''}`,
          'GET'
        )
        if (!mounted.current || request !== version.current) return
        const fresh = data.notifications.filter(
          (n) => !notifications.some((v) => v.id === n.id)
        )
        notifications.push(...fresh)
        hasMore = data.hasMore ?? data.notifications.length === 50
        if (!hasMore || !fresh.length) break
        const last = data.notifications[data.notifications.length - 1]
        params.set('before', data.nextCursor?.before || last.created_at)
        params.set('beforeId', data.nextCursor?.beforeId || last.id)
      }
      data = { ...data, notifications }
      if (mounted.current && request === version.current) {
        setFeed(data)
        setMore(hasMore)
        setError('')
      }
    } catch {
      if (mounted.current && request === version.current)
        setError('Unable to load notifications. Please retry.')
    } finally {
      if (mounted.current && request === version.current) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])
  const setCategory = (value: NotificationCategory | '') => {
    if (categoryRef.current === value) return
    categoryRef.current = value
    setCategoryState(value)
    pagesLoaded.current = 1
    version.current += 1
    setFeed((current) => ({
      notifications: [],
      unreadCount: current.unreadCount,
    }))
    setMore(false)
    setLoading(true)
    refresh()
  }
  const setStatus = (value: '' | 'read' | 'unread') => {
    if (statusRef.current === value) return
    statusRef.current = value
    setStatusState(value)
    pagesLoaded.current = 1
    version.current += 1
    setFeed((current) => ({
      notifications: [],
      unreadCount: current.unreadCount,
    }))
    setMore(false)
    setLoading(true)
    refresh()
  }
  const invalidate = useCallback(() => {
    version.current += 1
  }, [])
  useEffect(() => {
    setOwner(userId)
    categoryRef.current = ''
    setCategoryState('')
    statusRef.current = 'unread'
    setStatusState('unread')
    pagesLoaded.current = 1
    setFeed({ notifications: [], unreadCount: 0 })
    setLoading(true)
    setError('')
    setRefreshing(false)
    setMore(false)
    mounted.current = Boolean(userId)
    if (!userId) return undefined
    const ended = () => {
      mounted.current = false
      invalidate()
      setOwner(undefined)
      setFeed({ notifications: [], unreadCount: 0 })
      setMore(false)
    }
    window.addEventListener('marketplace-session-ended', ended)
    refresh()
    const stop = connectMessagesRealtime(
      userId,
      () => {},
      refresh,
      ended,
      refresh
    )
    return () => {
      mounted.current = false
      invalidate()
      stop()
      window.removeEventListener('marketplace-session-ended', ended)
    }
  }, [userId, refresh, invalidate])

  return {
    owner,
    ownerRef,
    feed,
    loading,
    refreshing,
    error,
    more,
    refresh,
    setError,
    setFeed,
    setMore,
    version,
    mounted,
    category,
    setCategory,
    status,
    setStatus,
    pagesLoaded,
  }
}
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { seller } = useMarketplaceSession()
  const state = useNotificationState(seller?.id)
  return (
    <Context.Provider
      value={seller && state.owner === seller.id ? state : null}
    >
      {children}
    </Context.Provider>
  )
}
