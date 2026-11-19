import { CircleAlert, CircleCheck } from 'lucide-react'
import type { ReactNode } from 'react'

import styles from './profile-status.module.css'

export type ProfileStatusTone = 'success' | 'warning' | 'error'

export function ProfileStatus({
  tone,
  children,
  alert = false,
}: {
  tone: ProfileStatusTone
  children: ReactNode
  alert?: boolean
}) {
  const Icon = tone === 'success' ? CircleCheck : CircleAlert
  return (
    <span
      className={`${styles.status} ${styles[tone]}`}
      role={alert ? 'alert' : undefined}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{children}</span>
    </span>
  )
}
