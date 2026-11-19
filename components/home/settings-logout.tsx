import { AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import actionStyles from '@/components/animata/button/action-button-sizing.module.css'
import ShiningButton from '@/components/animata/button/shining-button'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'

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
      <span className={styles.accountAction}>
        <ShiningButton
          variant="red"
          size="compact"
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
        </ShiningButton>
      </span>
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
          <ConfirmationDialog
            className={`${styles.dialog} ${actionStyles.contract}`}
            title="Log out?"
            onRequestClose={close}
            dismissDisabled={busy}
            error={error}
            cancel={{
              label: 'Cancel',
              variant: 'green',
              showArrow: false,
              disabled: busy,
              onClick: close,
            }}
            confirm={{
              label: succeeded ? 'Signed out' : 'Log out',
              variant: 'red',
              showArrow: false,
              disabled: busy,
              loading: busy,
              onClick: () => {
                if (busy) return
                pending.current = true
                setBusy(true)
                setError('')
                void onConfirm()
                  .then((reveal) => {
                    confirmed.current = reveal
                    setSucceeded(true)
                    successTimer.current = setTimeout(() => {
                      active.current = false
                      setOpen(false)
                    }, 450)
                  })
                  .catch((reason) => {
                    pending.current = false
                    setBusy(false)
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : 'Unable to sign out. Please retry.'
                    )
                  })
              },
            }}
          >
            <p className={styles.caption}>
              Are you sure you want to log out of this account?
            </p>
          </ConfirmationDialog>
        )}
      </AnimatePresence>
    </>
  )
}
