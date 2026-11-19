import type { MouseEventHandler, ReactNode } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { ActionTone } from './action-tone'

import { DialogActions } from './dialog-actions'
import { FadingDialog } from './fading-dialog'
import styles from './confirmation-dialog.module.css'

type DialogButton = {
  label: ReactNode
  variant?: 'green' | 'purple' | 'red' | 'outline'
  onClick: MouseEventHandler<HTMLButtonElement>
  disabled?: boolean
  loading?: boolean
  showArrow?: boolean
  arrowDirection?: 'left' | 'right'
}

/** A small two-action dialog built on the existing modal and action-row APIs. */
export function ConfirmationDialog({
  className,
  title,
  description,
  children,
  error,
  onRequestClose,
  dismissDisabled = false,
  tone,
  cancel,
  confirm,
}: {
  className?: string
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  error?: ReactNode
  onRequestClose: () => void
  dismissDisabled?: boolean
  /** Opt-in semantic color for the confirm action; cancel defaults to purple. */
  tone?: ActionTone
  cancel: DialogButton
  confirm: DialogButton
}) {
  // Existing callers keep their explicit colors and arrow defaults.
  // Opting into `tone` defaults both dialog arrows to hidden.
  const defaultShowArrow = tone === undefined
  return (
    <FadingDialog
      className={className}
      aria-label={typeof title === 'string' ? title : undefined}
      onRequestClose={() => {
        if (!dismissDisabled) onRequestClose()
      }}
    >
      <div className={styles.content}>
        <h3>{title}</h3>
        {description && <p>{description}</p>}
        {children}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <DialogActions>
          <span>
            <ShiningButton
              variant={cancel.variant ?? ActionTone.Default}
              size="compact"
              showArrow={cancel.showArrow ?? defaultShowArrow}
              arrowDirection={cancel.arrowDirection ?? 'left'}
              disabled={cancel.disabled}
              loading={cancel.loading}
              onClick={cancel.onClick}
            >
              {cancel.label}
            </ShiningButton>
          </span>
          <span>
            <ShiningButton
              variant={confirm.variant ?? tone ?? ActionTone.Default}
              size="compact"
              showArrow={confirm.showArrow ?? defaultShowArrow}
              arrowDirection={confirm.arrowDirection ?? 'right'}
              disabled={confirm.disabled}
              loading={confirm.loading}
              onClick={confirm.onClick}
            >
              {confirm.label}
            </ShiningButton>
          </span>
        </DialogActions>
      </div>
    </FadingDialog>
  )
}
