import type { ReactNode } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { ActionRow } from '@/components/ui/action-row'
import { ConfirmationDialog } from '@/components/ui/confirmation-dialog'
import { FadingDialog } from '@/components/ui/fading-dialog'

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
  if (!onSave) {
    return (
      <ConfirmationDialog
        className={styles.confirmation}
        title={title}
        description={children}
        error={error}
        dismissDisabled={Boolean(busy)}
        onRequestClose={onCancel}
        cancel={{
          label: 'Cancel',
          variant: 'purple',
          showArrow: false,
          disabled: busy,
          onClick: onCancel,
        }}
        confirm={{
          label: confirm,
          variant: 'red',
          showArrow: false,
          disabled: busy,
          loading: busy,
          onClick: onConfirm,
        }}
      />
    )
  }
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

      <ActionRow three={true}>
        <span>
          <ShiningButton
            variant="purple"
            showArrow={false}
            disabled={busy}
            onClick={onCancel}
          >
            Cancel
          </ShiningButton>
        </span>

        <span>
          <ShiningButton
            variant="red"
            showArrow={false}
            disabled={busy}
            loading={false}
            onClick={onConfirm}
          >
            {confirm}
          </ShiningButton>
        </span>

        <span>
          <ShiningButton
            variant="green"
            showArrow={false}
            disabled={busy || saveDisabled}
            loading={busy}
            onClick={onSave}
          >
            Save
          </ShiningButton>
        </span>
      </ActionRow>
    </FadingDialog>
  )
}
