import type { ButtonHTMLAttributes, ReactNode } from 'react'

import cardStyles from '@/components/velora/expandable-card.module.css'

import styles from './card-actions.module.css'

// The accepted expanded card's action geometry, raised surface, and states.
export function CardAction({
  children,
  className = '',
  surfaceClassName = '',
  variant = 'red',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode
  surfaceClassName?: string
  variant?: 'green' | 'red'
}) {
  return (
    <span className={`${cardStyles.actions} ${styles.single}`}>
      <button
        {...props}
        type={props.type === 'submit' ? 'submit' : 'button'}
        className={`${
          variant === 'green'
            ? 'shining-button shining-button--green'
            : cardStyles.raisedButtonDanger
        } ${className}`}
      >
        <span
          className={`${
            variant === 'green'
              ? 'shining-button__body'
              : cardStyles.raisedButtonDangerSurface
          } ${surfaceClassName}`}
        >
          {children}
        </span>
      </button>
    </span>
  )
}
