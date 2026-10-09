'use client'

import cn from 'classnames'
import { useEffect, useRef, useState } from 'react'

import styles from './stateful-button.module.css'

type ButtonState = 'error' | 'idle' | 'loading' | 'success'

interface StatefulButtonProps
  extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> {
  /** Click handler; return a Promise to show loading, then success or error. */
  onClick?: (event: React.MouseEvent<HTMLButtonElement>) => unknown
  /** Milliseconds the success or error state stays before returning to idle. */
  resetAfter?: number
  minLoadingMs?: number
  onStateChange?: (state: ButtonState) => void
  /** Shown beside the check and announced when the promise resolves. */
  successText?: string
  /** Shown beside the cross and announced when the promise rejects. */
  errorText?: string
  /** Keep a completed action visible until its owner changes/remounts the step. */
  retainSuccess?: boolean
}

// Every layer shares one grid cell, so the widest label sets a stable width.
const layer = styles.layer
const hidden = styles.hidden

/**
 * A button for async actions. When `onClick` returns a Promise the button
 * shrinks to a spinner, then shows a check (or a cross if it rejects) and
 * returns to idle after `resetAfter` ms. Its layout width never changes.
 * Recolour it with `[--surface:var(--color-brand)]`; style states with
 * `data-[state=success]:` and friends.
 */
export function StatefulButton({
  onClick,
  resetAfter = 2000,
  minLoadingMs = 0,
  onStateChange,
  successText = 'Done',
  errorText = 'Failed',
  retainSuccess = false,
  className,
  children,
  type = 'button',
  ...props
}: StatefulButtonProps) {
  const [state, setState] = useState<ButtonState>('idle')
  const [height, setHeight] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const pending = useRef(false)
  const mounted = useRef(true)
  const busy = state === 'loading'

  useEffect(() => {
    onStateChange?.(state)
  }, [state, onStateChange])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      clearTimeout(timer.current)
    }
  }, [])

  const handleClick = async (event: React.MouseEvent<HTMLButtonElement>) => {
    // aria-disabled (not disabled) keeps focus on the button while pending.
    if (pending.current || (retainSuccess && state === 'success')) {
      event.preventDefault()
      return
    }
    const result = onClick?.(event)
    if (!(result instanceof Promise)) return
    pending.current = true
    clearTimeout(timer.current)
    setHeight(event.currentTarget.offsetHeight)
    setState('loading')
    let next: ButtonState = 'success'
    const [outcome] = await Promise.allSettled([
      result,
      new Promise((resolve) => {
        setTimeout(resolve, minLoadingMs)
      }),
    ])
    if (outcome.status === 'rejected') next = 'error'
    pending.current = false
    if (!mounted.current) return
    setState(next)
    if (!(retainSuccess && next === 'success'))
      timer.current = setTimeout(() => setState('idle'), resetAfter)
  }

  let announcement = ''
  if (state === 'success') announcement = successText
  if (state === 'error') announcement = errorText
  return (
    <>
      <button
        // eslint-disable-next-line react/button-has-type -- Supplied reusable button forwards the typed HTML button type.
        type={type}
        {...props}
        data-state={state}
        aria-busy={busy || undefined}
        aria-disabled={
          busy || (retainSuccess && state === 'success')
            ? true
            : props['aria-disabled']
        }
        className={cn(styles.button, className)}
        onClick={handleClick}
      >
        {/* The visible pill: full width, or a circle while loading */}
        <span
          aria-hidden={true}
          className={styles.surface}
          style={{ width: busy && height ? height : '100%' }}
        />
        {/* Stays in the accessibility tree so the button's name never changes */}
        <span className={cn(layer, state !== 'idle' && styles.inactive)}>
          {children}
        </span>
        <span aria-hidden={true} className={cn(layer, !busy && hidden)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className={styles.spinner}
          >
            <circle cx="12" cy="12" r="9" opacity="0.3" />
            <path d="M21 12a9 9 0 0 0-9-9" />
          </svg>
        </span>
        <span
          aria-hidden={true}
          className={cn(layer, state !== 'success' && hidden)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={styles.icon}
          >
            {/* Draws itself in via the dash offset */}
            <path
              d="m5 12.5 4.5 4.5L19 7.5"
              pathLength={1}
              strokeDasharray={1}
              strokeDashoffset={state === 'success' ? 0 : 1}
              className={styles.check}
            />
          </svg>
          {successText}
        </span>
        <span
          aria-hidden={true}
          className={cn(layer, state !== 'error' && hidden)}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            className={styles.icon}
          >
            <path d="M7 7l10 10M17 7 7 17" />
          </svg>
          {errorText}
        </span>
      </button>
      <span role="status" className={styles.srOnly}>
        {announcement}
      </span>
    </>
  )
}
