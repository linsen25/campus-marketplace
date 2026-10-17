import { AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { StatefulButton } from '@/components/velora/stateful-button'

import financialStyles from './financial-settings.module.css'
import styles from './profile.module.css'

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
  const [succeeded, setSucceeded] = useState(false)
  const close = () => {
    if (pending.current) return
    active.current = false
    setOpen(false)
  }
  return (
    <>
      <StatefulButton
        className={`${financialStyles.setupAction} ${financialStyles.logoutAction}`}
        onClick={() => {
          active.current = true
          confirmed.current = null
          pending.current = false
          setBusy(false)
          setSucceeded(false)
          setError('')
          setOpen(true)
        }}
      >
        Log out
      </StatefulButton>
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
              <DynamicAction
                disabled={busy}
                variant="red"
                showArrow={false}
                onClick={close}
              >
                Cancel
              </DynamicAction>
              <DynamicAction
                variant="red"
                disabled={busy}
                onClick={async () => {
                  pending.current = true
                  setBusy(true)
                  setError('')
                  try {
                    confirmed.current = await onConfirm()
                    setSucceeded(true)
                    successTimer.current = setTimeout(() => {
                      active.current = false
                      setOpen(false)
                    }, 450)
                  } catch (reason) {
                    pending.current = false
                    setBusy(false)
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : 'Unable to sign out. Please retry.'
                    )
                  }
                }}
              >
                {succeeded ? 'Signed out' : 'Log out'}
              </DynamicAction>
            </ActionRow>
          </FadingDialog>
        )}
      </AnimatePresence>
    </>
  )
}
