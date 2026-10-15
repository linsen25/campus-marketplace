import { motion } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import sortStyles from '@/components/filter-interaction.module.css'
import { sortPanelFade } from '@/lib/sort-panel-fade'

import styles from './withdraw-context.module.css'

export function useWithdrawalEligibility(createdAt: string, enabled: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [enabled])
  return enabled && now < Date.parse(createdAt) + 300000
}

type FloatingElement = HTMLDivElement & {
  showPopover?: () => void
  hidePopover?: () => void
}

/** TEXT interaction only; sizing remains the caller's responsibility. */
export function WithdrawContext({
  enabled,
  createdAt,
  onWithdraw,
  children,
}: {
  enabled: boolean
  createdAt: string
  onWithdraw: () => Promise<void>
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const anchor = useRef<HTMLDivElement>(null)
  const panel = useRef<FloatingElement>(null)
  const busy = useRef(false)
  const eligible = useWithdrawalEligibility(createdAt, enabled)
  const close = (restore = false) => {
    setOpen(false)
    if (restore) anchor.current?.focus({ preventScroll: true })
  }
  useEffect(() => {
    if (!eligible) setOpen(false)
  }, [eligible])
  useEffect(() => {
    if (!open) return undefined
    const node = panel.current
    const position = () => {
      if (!node || !anchor.current) return
      const rect = (
        anchor.current.querySelector('p') || anchor.current
      ).getBoundingClientRect()
      node.style.left = `${Math.max(
        8,
        Math.min(
          rect.right - node.offsetWidth,
          innerWidth - node.offsetWidth - 8
        )
      )}px`
      const below = rect.bottom + 8
      const top =
        below + node.offsetHeight <= innerHeight - 8
          ? below
          : rect.top - node.offsetHeight - 8
      node.style.top = `${Math.max(
        8,
        Math.min(top, innerHeight - node.offsetHeight - 8)
      )}px`
    }
    node?.showPopover?.()
    position()
    node
      ?.querySelector<HTMLButtonElement>('[role="menuitem"]')
      ?.focus({ preventScroll: true })
    const outside = (event: PointerEvent) => {
      if (
        !node?.contains(event.target as Node) &&
        !anchor.current?.contains(event.target as Node)
      )
        close()
    }
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        close(true)
      }
    }
    const scroll = () => close()
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape, true)
    document.addEventListener('scroll', scroll, true)
    window.addEventListener('resize', position)
    return () => {
      node?.hidePopover?.()
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('scroll', scroll, true)
      window.removeEventListener('resize', position)
    }
  }, [open])
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Eligible TEXT content opens its contextual menu. */}
      <div
        ref={anchor}
        role="group"
        aria-label={eligible ? 'Own content actions' : undefined}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Keyboard menu target.
        tabIndex={eligible ? 0 : undefined}
        onKeyDown={(event) => {
          if (eligible && ['Enter', ' ', 'ContextMenu'].includes(event.key)) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        onClick={() => {
          if (eligible) setOpen(true)
        }}
      >
        {children}
      </div>
      {open && (
        <motion.div
          ref={panel}
          {...{ popover: 'manual' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={sortPanelFade}
          className={`${sortStyles.panel} ${sortStyles.sortPanel} ${styles.menu}`}
          role="menu"
          aria-label="Content actions"
        >
          {error && <p role="alert">{error}</p>}
          <button
            type="button"
            role="menuitem"
            className={sortStyles.option}
            disabled={pending || !eligible}
            onClick={async () => {
              if (busy.current || !eligible) return
              busy.current = true
              setPending(true)
              setError('')
              try {
                await onWithdraw()
                close(true)
              } catch (failure) {
                setError(
                  failure instanceof Error
                    ? failure.message
                    : 'Unable to withdraw. Refresh and retry.'
                )
              } finally {
                busy.current = false
                setPending(false)
              }
            }}
          >
            {pending ? 'Withdrawing…' : 'Withdraw'}
          </button>
        </motion.div>
      )}
    </>
  )
}
