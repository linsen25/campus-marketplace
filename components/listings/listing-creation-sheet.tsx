import { X } from 'lucide-react'
import { useCallback, useRef } from 'react'

import { FadingDialog } from '@/components/ui/fading-dialog'
import { listingWizardModes } from '@/lib/listing-wizard'
import type { Listing } from '@/types/listing'

import styles from './listing-creation-sheet.module.css'
import { ListingForm } from './listing-form'
import type { ListingLeaveGuard } from './listing-form'
/** Reuses FadingDialog's native modal, focus return and reference-counted scroll lock. */
export function ListingCreationSheet({
  mode,
  listing,
  onClose,
  onSaved,
  onGuardChange,
}: {
  mode: 'resale' | 'shop'
  listing?: Listing
  onClose: () => void
  onSaved: (listing: Listing) => void
  onGuardChange: (guard: ListingLeaveGuard | null) => void
}) {
  let heading: string = listingWizardModes[mode].heading
  if (listing) heading = mode === 'resale' ? 'Edit Resale' : 'Edit Product'
  const guard = useRef<ListingLeaveGuard | null>(null)
  const setGuard = useCallback(
    (value: ListingLeaveGuard | null) => {
      guard.current = value
      onGuardChange(value)
    },
    [onGuardChange]
  )
  const close = () => {
    if (guard.current) guard.current(onClose)
    else onClose()
  }
  return (
    <FadingDialog
      dismissOnBackdrop={false}
      focusAtTop={true}
      tabIndex={-1}
      className={styles.dialog}
      aria-label={heading}
      data-listing-creation-sheet={mode}
      data-listing-creation-mode={listing ? 'edit' : 'create'}
      onRequestClose={close}
    >
      <header className={styles.header}>
        <h2>{heading}</h2>
        <button type="button" aria-label={`Close ${heading}`} onClick={close}>
          <X size={21} aria-hidden={true} />
        </button>
      </header>
      <div className={styles.body} data-listing-creation-scroll={true}>
        <ListingForm
          key={listing?.id ?? 'create'}
          listing={listing}
          mode={mode}
          presentation="sheet"
          onCancel={close}
          onSaved={onSaved}
          onGuardChange={setGuard}
        />
      </div>
    </FadingDialog>
  )
}
