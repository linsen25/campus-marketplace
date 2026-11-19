import { X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { parseOfferAmount } from '@/lib/offer-amount'
import { costInputText } from '@/lib/shop-costs'
import { getShopCost, saveShopCost } from '@/lib/shop-costs-api'
import type { Listing } from '@/types/listing'
import type { ShopCost } from '@/types/shop-costs'

import styles from './shop-analysis.module.css'

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
