// CSS Modules adaptation of the supplied Animata Work Button.
import type { ButtonHTMLAttributes, ReactNode } from 'react'

import { useDesktopRouteTransition } from '@/components/navigation/desktop-route-transition'
import { Link } from '@ui/link/link'

import styles from './work-button.module.css'

export default function WorkButton({
  children = 'Home',
  className = '',
  appearance = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  appearance?: 'default' | 'pagination'
}) {
  return (
    <button
      {...props}
      type="button"
      className={`${styles.button} ${
        appearance === 'pagination' ? styles.pagination : ''
      } ${className}`}
    >
      <span className={styles.sweep} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
    </button>
  )
}

export function WorkProfile({
  href,
  children,
}: {
  href: string
  children: ReactNode
}) {
  const navigate = useDesktopRouteTransition()
  return (
    <Link
      href={href}
      prefetch={false}
      aria-label="Home"
      className={`${styles.button} ${styles.profile}`}
      onClick={(event) => navigate(event, href)}
    >
      <span className={styles.sweep} aria-hidden="true" />
      <span className={styles.label}>{children}</span>
    </Link>
  )
}
