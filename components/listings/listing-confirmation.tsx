import type { ReactNode } from 'react'

import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'

import { CardAction } from './card-actions'
import styles from './listing-workspace.module.css'

export function ListingConfirmation({
  title,
  children,
  confirm,
  busy,
  error,
  onCancel,
  onConfirm,
  onSave,
  saveDisabled,
}: {
  title: string
  children: ReactNode
  confirm: string
  busy?: boolean
  error?: string
  onCancel: () => void
  onSave?: () => void
  saveDisabled?: boolean
  onConfirm: () => void
}) {
  return (
    <FadingDialog
      className={styles.confirmation}
      aria-label={title}
      onRequestClose={() => {
        if (!busy) onCancel()
      }}
    >
      <h3>{title}</h3>
      <p>{children}</p>
      {error && <p role="alert">{error}</p>}
      <ActionRow three={Boolean(onSave)}>
        <CardAction
          className={styles.neutralButton}
          surfaceClassName={styles.neutralSurface}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </CardAction>
        <CardAction disabled={busy} onClick={onConfirm}>
          {busy ? 'Working...' : confirm}
        </CardAction>
        {onSave && (
          <DynamicAction
            variant="green"
            footer={true}
            disabled={busy || saveDisabled}
            onClick={onSave}
          >
            {busy ? 'Saving...' : 'Save'}
          </DynamicAction>
        )}
      </ActionRow>
    </FadingDialog>
  )
}
