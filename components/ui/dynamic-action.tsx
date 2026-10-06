import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'

import styles from './dynamic-action.module.css'

export function DynamicAction({
  children,
  variant,
  disabled,
  footer = false,
  className = '',
  onClick,
}: {
  children: ReactNode
  variant: 'blue' | 'dark-blue' | 'green' | 'red'
  disabled?: boolean
  footer?: boolean
  className?: string
  onClick: () => Promise<void> | void
}) {
  const [pending, setPending] = useState(false)
  const locked = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])
  const activate = () => {
    if (disabled || locked.current) return
    locked.current = true
    setPending(true)
    timer.current = setTimeout(async () => {
      try {
        await onClick()
      } finally {
        locked.current = false
        if (mounted.current) setPending(false)
      }
    }, 200)
  }
  return (
    <span
      className={`${className} ${styles.action} ${
        footer ? styles.footer : ''
      } ${pending ? styles.pending : ''}`}
      data-action-pending={pending || undefined}
    >
      <ShiningButton
        variant={variant}
        desktopAppearance={true}
        disabled={disabled}
        loading={pending}
        onClick={activate}
      >
        {children}
      </ShiningButton>
    </span>
  )
}
