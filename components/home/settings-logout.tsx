import { AnimatePresence } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { StatefulButton } from '@/components/velora/stateful-button'

import styles from './profile.module.css'
import buttonStyles from './settings-logout.module.css'

export function SettingsLogout({
  onConfirm,
}: {
  onConfirm: () => Promise<() => void>
}) {
  const [open, setOpen] = useState(false)
  const active = useRef(false)
  const confirmed = useRef<(() => void) | null>(null)
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const successTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(successTimer.current), [])
  const stateChanged = useCallback((state: string) => {
    if (state === 'success') {
      successTimer.current = setTimeout(() => {
        active.current = false
        setOpen(false)
      }, 450)
    }
  }, [])
  const close = () => {
    if (pending.current) return
    active.current = false
    setOpen(false)
  }
  return (
    <>
      <DynamicAction
        variant="red"
        footer={true}
        onClick={() => {
          active.current = true
          confirmed.current = null
          pending.current = false
          setBusy(false)
          setError('')
          setOpen(true)
        }}
      >
        Log out
      </DynamicAction>
      <AnimatePresence
        onExitComplete={() => {
          if (confirmed.current) {
            const reveal = confirmed.current
            confirmed.current = null
            reveal()
          }
        }}
      >
        {open && (
          <FadingDialog
            className={styles.dialog}
            aria-labelledby="logout-confirm-title"
            onRequestClose={close}
          >
            <h3 id="logout-confirm-title">Log out?</h3>
            <p className={styles.caption}>
              Are you sure you want to log out of this account?
            </p>
            {error && <p role="alert">{error}</p>}
            <ActionRow>
              <CardAction disabled={busy} variant="green" onClick={close}>
                Cancel
              </CardAction>
              <span className={buttonStyles.slot}>
                <StatefulButton
                  className={buttonStyles.button}
                  successText="Signed out"
                  errorText="Retry"
                  onStateChange={stateChanged}
                  onClick={async () => {
                    pending.current = true
                    setBusy(true)
                    setError('')
                    try {
                      confirmed.current = await onConfirm()
                    } catch (reason) {
                      pending.current = false
                      setBusy(false)
                      setError(
                        reason instanceof Error
                          ? reason.message
                          : 'Unable to sign out. Please retry.'
                      )
                      throw reason
                    }
                  }}
                >
                  Log out
                </StatefulButton>
              </span>
            </ActionRow>
          </FadingDialog>
        )}
      </AnimatePresence>
    </>
  )
}
