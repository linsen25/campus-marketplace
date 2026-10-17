import SquishSwitch from '@/components/react-bits/squish-switch'
import { Skeleton } from '@/components/ui/skeleton'

import styles from './notification-settings.module.css'
import { useNotifications } from './notification-state'

const rows = [
  [
    'inApp',
    'In-app notifications',
    'Show realtime notification popups inside Usual & Unusual.',
  ],
  [
    'sounds',
    'Notification sounds',
    'Play a sound when a new in-app notification arrives.',
  ],
  [
    'email',
    'Email notifications',
    'Send important activity updates to your email.',
  ],
] as const
export function NotificationSettings() {
  const state = useNotifications()
  if (!state) return null
  const { data, error, pending, saveErrors, refresh, save } = state.preferences
  return (
    <section className={styles.section} aria-label="Notification preferences">
      <h3>Notifications</h3>
      {rows.map(([key, label, description]) => (
        <div key={key} className={styles.row} aria-busy={pending[key]}>
          <div>
            <p className={styles.label}>{label}</p>
            <p className={styles.description}>{description}</p>
            {saveErrors[key] && <p role="alert">{saveErrors[key]}</p>}
          </div>
          {data ? (
            <SquishSwitch
              checked={data[key]}
              ariaLabel={label}
              width={56}
              height={30}
              radius={15}
              trackOnColor="#9375c4"
              thumbColor="#737078"
              thumbOnColor="#f5f5f5"
              onChange={(value) => save(key, value)}
            />
          ) : (
            <Skeleton style={{ width: 56, height: 30, borderRadius: 15 }} />
          )}
        </div>
      ))}
      {error && (
        <p role="alert">
          {error}{' '}
          <button type="button" onClick={refresh}>
            Retry
          </button>
        </p>
      )}
    </section>
  )
}
