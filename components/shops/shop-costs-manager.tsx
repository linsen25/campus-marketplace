import { AnimatePresence } from 'framer-motion'
import { X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { ListingConfirmation } from '@/components/listings/listing-confirmation'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { parseOfferAmount } from '@/lib/offer-amount'
import { costInputText, privateCostMoney } from '@/lib/shop-costs'
import {
  deleteShopExpense,
  getShopCost,
  getShopExpenses,
  saveShopCost,
  saveShopExpense,
} from '@/lib/shop-costs-api'
import type { Listing } from '@/types/listing'
import type { ShopCost, ShopExpenseRecord } from '@/types/shop-costs'

import styles from './shop-analysis.module.css'
import { ExpenseDialog } from './shop-expense-dialog'

const failure = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : 'Private Shop records unavailable. Please retry.'

export function ProductCostDialog({
  listing,
  onClose,
}: {
  listing: Listing
  onClose: () => void
}) {
  const [cost, setCost] = useState<ShopCost | null>(null)
  const [amount, setAmount] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const pending = useRef(false)
  useEffect(() => {
    let current = true
    setCost(null)
    setError('')
    getShopCost(listing.id)
      .then((value) => {
        if (current) {
          setCost(value)
          setAmount(
            value.amountCents === null ? '' : costInputText(value.amountCents)
          )
        }
      })
      .catch((reason) => {
        if (current) setError(failure(reason))
      })
    return () => {
      current = false
    }
  }, [listing.id, reload])
  const close = () => {
    if (!pending.current) onClose()
  }
  return (
    <FadingDialog
      className={styles.dialog}
      aria-label="Product cost"
      onRequestClose={close}
    >
      <header className={styles.row}>
        <h2>Product cost</h2>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close Product cost"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <p className={styles.muted}>{listing.title}</p>
      {!cost && !error && <p role="status">Loading cost...</p>}
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (!cost || pending.current) return
          const value =
            amount.trim() === '' ? null : parseOfferAmount(amount, true)
          if (amount.trim() && value === null) {
            setError(
              'Enter a non-negative CAD amount with up to two decimal places.'
            )
            return
          }
          pending.current = true
          setBusy(true)
          setError('')
          try {
            await saveShopCost(cost, value)
            onClose()
          } catch (reason) {
            setError(failure(reason))
          } finally {
            pending.current = false
            setBusy(false)
          }
        }}
      >
        <label className={styles.field}>
          Product cost (CAD)
          <input
            inputMode="decimal"
            value={amount}
            disabled={!cost || busy}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <p className={styles.muted}>
          Leave blank for Unknown. Enter 0 for a known zero cost. Existing
          Orders keep their original cost.
        </p>
        <div className={styles.dialogActions}>
          <ShiningButton
            disabled={busy}
            onClick={() => setReload((value) => value + 1)}
          >
            Reload
          </ShiningButton>
          <ShiningButton
            type="submit"
            loading={busy}
            disabled={!cost || busy}
            onClick={() => {
              /* Submit through the form, not the button's default login action. */
            }}
          >
            Save
          </ShiningButton>
        </div>
      </form>
    </FadingDialog>
  )
}

function ExpenseList({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ShopExpenseRecord[]>([])
  const [cursor, setCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<{
    id: string
    expense?: ShopExpenseRecord
  } | null>(null)
  const [deleting, setDeleting] = useState<ShopExpenseRecord | null>(null)
  const [saving, setSaving] = useState(false)
  const pending = useRef(false)
  const generation = useRef(0)
  const invalidate = useCallback(() => {
    generation.current++
  }, [])
  const load = useCallback(async (before?: string) => {
    const request = ++generation.current
    setLoading(true)
    setError('')
    try {
      const page = await getShopExpenses(before)
      if (request === generation.current) {
        setRows((old) => (before ? [...old, ...page.expenses] : page.expenses))
        setCursor(page.nextCursor)
      }
    } catch (reason) {
      if (request === generation.current) setError(failure(reason))
    } finally {
      if (request === generation.current) setLoading(false)
    }
  }, [])
  useEffect(() => {
    load()
    return invalidate
  }, [load, invalidate])
  return (
    <>
      <FadingDialog
        className={styles.dialog}
        aria-label="Shop expenses"
        onRequestClose={onClose}
      >
        <header className={styles.row}>
          <h2>Expenses</h2>
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Close Expenses"
            onClick={onClose}
          >
            <X size={20} />
          </button>
        </header>
        <p className={styles.muted}>
          Private operating expenses. Available even when your Shop is
          suspended.
        </p>
        <div className={styles.dialogActions}>
          <ShiningButton disabled={loading} onClick={() => load()}>
            Reload
          </ShiningButton>
          <ShiningButton
            onClick={() => setEditing({ id: crypto.randomUUID() })}
          >
            Add expense
          </ShiningButton>
        </div>
        {loading && <p role="status">Loading expenses...</p>}
        {error && <p role="alert">{error}</p>}
        {!loading && !error && !rows.length && (
          <p className={styles.empty}>No expenses yet.</p>
        )}
        <ul aria-label="Saved expenses">
          {rows.map((expense) => (
            <li key={expense.id} className={styles.module}>
              <p style={{ overflowWrap: 'anywhere' }}>
                {expense.on} · {expense.kind} ·{' '}
                {privateCostMoney(expense.amountCents)}
              </p>
              {expense.description && (
                <p
                  className={styles.muted}
                  style={{ overflowWrap: 'anywhere' }}
                >
                  {expense.description}
                </p>
              )}
              <div className={styles.dialogActions}>
                <ShiningButton
                  onClick={() => setEditing({ id: expense.id, expense })}
                >
                  Edit
                </ShiningButton>
                <ShiningButton
                  variant="red"
                  onClick={() => {
                    setError('')
                    setDeleting(expense)
                  }}
                >
                  Delete
                </ShiningButton>
              </div>
            </li>
          ))}
        </ul>
        {cursor && (
          <ShiningButton disabled={loading} onClick={() => load(cursor)}>
            Load more
          </ShiningButton>
        )}
      </FadingDialog>
      <AnimatePresence>
        {editing && (
          <ExpenseDialog
            key={editing.id}
            initial={editing.expense}
            onClose={() => setEditing(null)}
            onSave={async (fields) => {
              const record = await saveShopExpense(
                editing.id,
                fields,
                editing.expense?.revision
              )
              if (record.deletedAt)
                throw Error(
                  'This expense was already deleted. Close and reload your expenses.'
                )
              await load()
            }}
          />
        )}
        {deleting && (
          <ListingConfirmation
            title="Delete this expense?"
            confirm="Delete"
            busy={saving}
            error={error}
            onCancel={() => {
              if (!pending.current) {
                setDeleting(null)
                setError('')
              }
            }}
            onConfirm={async () => {
              if (pending.current) return
              pending.current = true
              setSaving(true)
              setError('')
              try {
                await deleteShopExpense(deleting)
                setDeleting(null)
                await load()
              } catch (reason) {
                setError(failure(reason))
              } finally {
                pending.current = false
                setSaving(false)
              }
            }}
          >
            The expense will be removed from active lists. Its stored record is
            retained.
          </ListingConfirmation>
        )}
      </AnimatePresence>
    </>
  )
}

export function ShopExpenses() {
  const [open, setOpen] = useState(false)
  return (
    <>
      <ShiningButton onClick={() => setOpen(true)}>Expenses</ShiningButton>
      <AnimatePresence>
        {open && <ExpenseList onClose={() => setOpen(false)} />}
      </AnimatePresence>
    </>
  )
}
