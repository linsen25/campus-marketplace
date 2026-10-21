import { X } from 'lucide-react'
import { useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import FilterInteraction from '@/components/filter-interaction'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { shopAnalysisFixtureAsOf } from '@/lib/fixtures/shop-analysis-fixture'
import { parseOfferAmount } from '@/lib/offer-amount'
import type { ShopExpense } from '@/lib/shop-analysis'
import {
  costInputText,
  shopBusinessDate,
  validExpenseDate,
} from '@/lib/shop-costs'
import type { ShopExpenseFields, ShopExpenseRecord } from '@/types/shop-costs'

import styles from './shop-analysis.module.css'

export function ExpenseDialog({
  onClose,
  onAdd,
  initial,
  onSave,
}: {
  onClose: () => void
  onAdd?: (expense: ShopExpense) => void
  initial?: ShopExpenseRecord
  onSave?: (fields: ShopExpenseFields) => Promise<void>
}) {
  const live = Boolean(onSave)
  const today = live ? shopBusinessDate() : shopAnalysisFixtureAsOf
  const [portal, setPortal] = useState<HTMLFormElement | null>(null)
  const [kind, setKind] = useState<string>(initial?.kind || 'Packaging')
  const [amount, setAmount] = useState(
    initial ? costInputText(initial.amountCents) : ''
  )
  const [date, setDate] = useState(initial?.on || today)
  const [description, setDescription] = useState(initial?.description || '')
  const [error, setError] = useState('')
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const saving = useRef(false)
  let submitLabel = 'Add demo expense'
  if (live) submitLabel = initial ? 'Save' : 'Add expense'
  const dialogLabel = initial ? 'Edit expense' : 'Add expense'
  const close = () => {
    if (!saving.current) onClose()
  }
  return (
    <FadingDialog
      className={styles.dialog}
      aria-label={live ? dialogLabel : 'Add demo expense'}
      onRequestClose={close}
    >
      <header className={styles.row}>
        <h2>{initial ? 'Edit Expense' : 'Add Expense'}</h2>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close Add Expense"
          disabled={pending}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <p className={styles.muted}>
        {live
          ? 'Private Shop expense. Changes are saved to your account.'
          : 'Demo only. Changes stay in this page session and are not saved to your account.'}
      </p>
      <form
        ref={setPortal}
        onSubmit={async (event) => {
          event.preventDefault()
          if (saving.current) return
          const cents = parseOfferAmount(amount)
          if (cents === null || cents <= 0) {
            setError(
              'Enter a positive CAD amount with up to two decimal places.'
            )
            return
          }
          if (
            live
              ? !validExpenseDate(date, today)
              : !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
                !Number.isFinite(Date.parse(date)) ||
                date > today
          ) {
            setError(
              live
                ? 'Choose a valid date on or before today in Toronto.'
                : 'Choose a valid date on or before the demo date.'
            )
            return
          }
          const fields = {
            kind: kind as ShopExpenseFields['kind'],
            amountCents: cents,
            currency: 'CAD' as const,
            on: date,
            description,
          }
          if (onSave) {
            saving.current = true
            setPending(true)
            setError('')
            try {
              await onSave(fields)
              onClose()
            } catch (reason) {
              setError(
                reason instanceof Error
                  ? reason.message
                  : 'Unable to save expense. Please retry.'
              )
            } finally {
              saving.current = false
              setPending(false)
            }
            return
          }
          onAdd?.({
            id: crypto.randomUUID(),
            channel: 'shop',
            kind: kind as ShopExpense['kind'],
            on: date,
            amountCents: cents,
            description,
          })
          onClose()
        }}
      >
        <div className={styles.field}>
          <span>Expense Type</span>
          <FilterInteraction
            appearance="select"
            isOpen={open}
            disabled={pending}
            portalContainer={portal ?? undefined}
            label="Expense Type"
            value={kind}
            options={['Packaging', 'Marketing', 'Other'].map((value) => ({
              value,
              label: value,
            }))}
            onOpenChange={setOpen}
            onChange={setKind}
          />
        </div>
        <label className={styles.field}>
          Amount (CAD)
          <input
            required={true}
            inputMode="decimal"
            disabled={pending}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          Date
          <input
            required={true}
            type="date"
            max={today}
            disabled={pending}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label className={styles.field}>
          Description (optional)
          <textarea
            maxLength={500}
            disabled={pending}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <div className={styles.dialogActions}>
          <ShiningButton type="button" disabled={pending} onClick={close}>
            Cancel
          </ShiningButton>
          <ShiningButton
            type="submit"
            disabled={pending}
            loading={pending}
            onClick={
              live
                ? () => {
                    /* Live owner saves submit through the form. */
                  }
                : undefined
            }
          >
            {submitLabel}
          </ShiningButton>
        </div>
      </form>
    </FadingDialog>
  )
}
