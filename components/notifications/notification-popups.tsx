import { AnimatePresence, m, useReducedMotion } from 'framer-motion'
import { Bell, MessageCircle, Package, Tag, X } from 'lucide-react'
import { useRouter } from 'next/router'
import { useEffect, useRef, useState } from 'react'

import { notificationCategory } from '@/lib/notification-category'
import type { NotificationItem } from '@/lib/notification-category'
import { notificationUiTarget } from '@/lib/notification-navigation'
import { notificationCopy } from '@/lib/notification-presentation'

import styles from './notification-popups.module.css'
import { useNotifications } from './notification-state'

const icons = {
  message: MessageCircle,
  order: Package,
  listing: Tag,
  system: Bell,
}
export function NotificationPopups() {
  const state = useNotifications()
  const [limit, setLimit] = useState(1)
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const change = () => setLimit(query.matches ? 3 : 1)
    change()
    query.addEventListener('change', change)
    return () => query.removeEventListener('change', change)
  }, [])
  if (!state) return null
  return (
    <aside className={styles.stack} aria-label="New notifications">
      <AnimatePresence>
        {state.popups.items.slice(0, limit).map((item) => (
          <Popup key={item.id} item={item} />
        ))}
      </AnimatePresence>
    </aside>
  )
}
function Popup({ item }: { item: NotificationItem }) {
  const state = useNotifications()!
  const router = useRouter()
  const reduced = useReducedMotion()
  const busy = useRef(false)
  const hovered = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const category = notificationCategory(item)
  const Icon = icons[category]
  const target = notificationUiTarget(item.destination, item.event_type)
  const { dismiss } = state.popups
  useEffect(() => {
    const timer = setInterval(() => {
      if (!hovered.current && !busy.current) dismiss(item.id)
    }, 6000)
    return () => clearInterval(timer)
  }, [dismiss, item.id])
  async function open() {
    if (!target || busy.current) return
    busy.current = true
    setPending(true)
    setError('')
    const owner = state.ownerRef.current
    try {
      await state.markRead(item)
      if (!state.mounted.current || state.ownerRef.current !== owner) return
      await router.push(target)
      dismiss(item.id)
    } catch {
      setError('Unable to open notification. Please retry.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <m.div
      className={styles.popup}
      data-category={category}
      initial={{ opacity: 0, y: reduced ? 0 : -6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{ duration: reduced ? 0 : 0.16 }}
      onMouseEnter={() => {
        hovered.current = true
      }}
      onMouseLeave={() => {
        hovered.current = false
      }}
      onFocusCapture={() => {
        hovered.current = true
      }}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget))
          hovered.current = false
      }}
    >
      {target ? (
        <button
          type="button"
          className={styles.content}
          disabled={pending}
          aria-label={`Open notification: ${
            notificationCopy(item.event_type).title
          }`}
          onClick={() => open()}
        >
          <Icon size={20} />
          <span>
            <small>{category.toUpperCase()}</small>
            <strong>{notificationCopy(item.event_type).title}</strong>
          </span>
        </button>
      ) : (
        <div className={styles.content} role="status">
          <Icon size={20} />
          <span>
            <small>{category.toUpperCase()}</small>
            <strong>{notificationCopy(item.event_type).title}</strong>
          </span>
        </div>
      )}
      <button
        className={styles.dismiss}
        type="button"
        aria-label="Dismiss notification"
        onClick={() => dismiss(item.id)}
      >
        <X size={16} />
      </button>
      {error && <p role="alert">{error}</p>}
    </m.div>
  )
}
