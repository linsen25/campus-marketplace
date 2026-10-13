import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'

import styles from './offer-ui.module.css'

export function useWithdrawalEligibility(createdAt: string, enabled: boolean) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!enabled) return undefined
    const tick = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(tick)
  }, [enabled])
  return enabled && now < Date.parse(createdAt) + 300000
}

/** Presentation eligibility only; the server owns the five-minute deadline. */
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
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const releaseTimer = useRef<ReturnType<typeof setTimeout>>()
  const suppress = useRef(false)
  const busy = useRef(false)
  const eligible = useWithdrawalEligibility(createdAt, enabled)
  useEffect(() => () => clearTimeout(timer.current), [])
  useEffect(() => {
    if (!open) return undefined
    // A long press opens a portal above the original touch. Its compatibility
    // click can land on the new backdrop instead of bubbling through the group.
    const release = () => {
      if (!suppress.current) return
      clearTimeout(releaseTimer.current)
      releaseTimer.current = setTimeout(() => {
        suppress.current = false
      }, 250)
    }
    document.addEventListener('pointerup', release, true)
    document.addEventListener('touchend', release, true)
    return () => {
      document.removeEventListener('pointerup', release, true)
      document.removeEventListener('touchend', release, true)
      clearTimeout(releaseTimer.current)
      suppress.current = false
    }
  }, [open])
  return (
    <>
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- This content group exposes its conventional context menu by pointer and keyboard. */}
      <div
        role="group"
        aria-label={eligible ? 'Own content actions' : undefined}
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Own content supports the conventional keyboard context-menu shortcut.
        tabIndex={eligible ? 0 : undefined}
        onKeyDown={(event) => {
          if (
            eligible &&
            (event.key === 'ContextMenu' ||
              (event.shiftKey && event.key === 'F10'))
          ) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        onPointerDown={(event) => {
          if (!eligible || event.pointerType === 'mouse') return
          timer.current = setTimeout(() => {
            suppress.current = true
            setOpen(true)
          }, 550)
        }}
        onPointerUp={() => clearTimeout(timer.current)}
        onPointerCancel={() => clearTimeout(timer.current)}
        onPointerMove={() => clearTimeout(timer.current)}
        onContextMenu={(event) => {
          if (eligible) {
            event.preventDefault()
            setOpen(true)
          }
        }}
        onClickCapture={(event) => {
          if (suppress.current) {
            suppress.current = false
            event.preventDefault()
            event.stopPropagation()
          } else if (
            eligible &&
            !(event.target as Element).closest('button,a,input,textarea,select')
          ) {
            setOpen(true)
          }
        }}
      >
        {children}
      </div>
      {open && (
        <FadingDialog
          className={styles.confirm}
          aria-label="Message actions"
          onRequestClose={() => {
            if (!pending && !suppress.current) setOpen(false)
          }}
          onClickCapture={() => {
            suppress.current = false
          }}
          onKeyDownCapture={(event) => {
            if (event.key === 'Escape') suppress.current = false
          }}
        >
          <h3>Actions</h3>
          {error && <p role="alert">{error}</p>}
          <ActionRow>
            <CardAction
              variant="red"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Close
            </CardAction>
            {eligible && (
              <CardAction
                variant="red"
                disabled={pending}
                onClick={async () => {
                  if (busy.current) return
                  busy.current = true
                  setPending(true)
                  setError('')
                  try {
                    await onWithdraw()
                    setOpen(false)
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
              </CardAction>
            )}
          </ActionRow>
        </FadingDialog>
      )}
    </>
  )
}
