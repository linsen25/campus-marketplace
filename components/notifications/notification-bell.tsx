import { Bell } from 'lucide-react'
import { useRouter } from 'next/router'

import styles from './notification-bell.module.css'
import { useNotifications } from './notification-state'

export function NotificationBell() {
  const state = useNotifications()
  const router = useRouter()
  if (!state) return null
  return (
    <button
      type="button"
      className={styles.bell}
      aria-label={`Notifications, ${state.feed.unreadCount} unread`}
      onClick={() => router.push('/home?section=notifications')}
    >
      <Bell size={22} aria-hidden={true} />
      {state.feed.unreadCount > 0 && (
        <span className={styles.count} aria-hidden={true}>
          {state.feed.unreadCount > 99 ? '99+' : state.feed.unreadCount}
        </span>
      )}
    </button>
  )
}
