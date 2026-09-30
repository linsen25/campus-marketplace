import { useRouter } from 'next/router'

import styles from './back-button.module.css'

type BackButtonProps = {
  href: string
  useHistory?: boolean
  className?: string
}

export function BackButton({
  href,
  useHistory = false,
  className = '',
}: BackButtonProps) {
  const router = useRouter()
  return (
    <button
      type="button"
      aria-label="Back"
      className={`${styles.button} ${className}`}
      onClick={() => {
        if (useHistory) router.back()
        else router.push(href)
      }}
    >
      <svg
        width="24"
        height="24"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden="true"
      >
        <path d="M19 12H5m7-7-7 7 7 7" />
      </svg>
    </button>
  )
}
