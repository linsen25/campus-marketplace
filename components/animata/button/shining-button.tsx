import cn from 'classnames'
import { ArrowRight } from 'lucide-react'
import type { MouseEventHandler, ReactNode } from 'react'

import { Link } from '@ui/link/link'

import styles from './responsive-action-button.module.css'

export default function ShiningButton({
  children = 'Log in',
  href = '/auth/sign-in',
  onClick,
  variant = 'purple',
  disabled = false,
  desktopAppearance = false,
}: {
  children?: ReactNode
  href?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  variant?: 'green' | 'purple'
  disabled?: boolean
  desktopAppearance?: boolean
}) {
  const className = cn(
    'shining-button',
    desktopAppearance && styles.desktopAppearance,
    {
      'shining-button--green': variant === 'green',
    }
  )
  const content = (
    <span className="shining-button__body">
      {children}
      <ArrowRight
        className="shining-button__arrow"
        aria-hidden="true"
        size={24}
      />
      <span className="shining-button__highlight" aria-hidden="true" />
    </span>
  )
  const shiningAction = onClick ? (
    <button
      type="button"
      className={className}
      disabled={disabled}
      onClick={onClick}
    >
      {content}
    </button>
  ) : (
    <Link href={href} className={className}>
      {content}
    </Link>
  )
  return shiningAction
}
