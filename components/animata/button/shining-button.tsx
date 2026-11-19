import cn from 'classnames'
import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { MouseEventHandler, ReactNode } from 'react'

import { useAuthModal } from '@/components/auth/auth-modal'
import { Link } from '@ui/link/link'

import styles from './responsive-action-button.module.css'

export default function ShiningButton({
  children = 'Log in',
  href,
  onClick,
  onNavigate,
  variant = 'purple',
  size = 'default',
  disabled = false,
  desktopAppearance = false,
  loading = false,
  showArrow = true,
  arrowDirection = 'right',
  type = 'button',
  form,
}: {
  children?: ReactNode
  href?: string
  onClick?: MouseEventHandler<HTMLButtonElement>
  onNavigate?: MouseEventHandler<HTMLAnchorElement>
  variant?: 'blue' | 'dark-blue' | 'green' | 'purple' | 'red' | 'outline'
  size?: 'default' | 'compact'
  disabled?: boolean
  loading?: boolean
  showArrow?: boolean
  arrowDirection?: 'left' | 'right'
  type?: 'button' | 'submit'
  form?: string
  desktopAppearance?: boolean
}) {
  const { openAuth } = useAuthModal()
  const className = cn(
    'shining-button',
    size === 'compact' && 'shining-button--compact',
    desktopAppearance && styles.desktopAppearance,
    variant === 'red' && styles.red,
    variant === 'blue' && styles.blue,
    variant === 'dark-blue' && styles.darkBlue,
    variant === 'outline' && 'shining-button--outline',
    {
      'shining-button--green': variant === 'green',
    }
  )
  const content = (
    <span className="shining-button__body">
      {showArrow && arrowDirection === 'left' && (
        <ArrowLeft
          className="shining-button__arrow shining-button__arrow--left"
          aria-hidden="true"
          size={24}
        />
      )}
      <span className="shining-button__label">{children}</span>
      {showArrow && arrowDirection === 'right' && (
        <ArrowRight
          className="shining-button__arrow"
          aria-hidden="true"
          size={24}
        />
      )}
      <span className="shining-button__highlight" aria-hidden="true" />
    </span>
  )
  const shiningAction =
    onClick || !href ? (
      <button
        type={type === 'submit' ? 'submit' : 'button'}
        form={form}
        className={className}
        disabled={disabled}
        aria-busy={loading || undefined}
        aria-disabled={disabled || loading || undefined}
        onClick={
          onClick || (() => openAuth({ mode: 'signin', intent: 'login' }))
        }
      >
        {content}
      </button>
    ) : (
      <Link href={href} className={className} onClick={onNavigate}>
        {content}
      </Link>
    )
  return shiningAction
}
