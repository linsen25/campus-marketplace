import { Minus, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { adjustShopInventory, getShopInventory } from '@/lib/shop-inventory-api'
import type { Listing, ShopInventory } from '@/types/listing'

import styles from './shop-analysis.module.css'

const failure = (reason: unknown) =>
  reason instanceof Error
    ? reason.message
    : 'Inventory is temporarily unavailable. Please retry.'

export function ProductInventoryDialog({
  listing,
  onClose,
  onSaved,
}: {
  listing: Listing
  onClose: () => void
  onSaved: (inventory: ShopInventory) => void
}) {
  const [inventory, setInventory] = useState<ShopInventory | null>(
    listing.inventory ?? null
  )
  const [amount, setAmount] = useState('1')
  const [direction, setDirection] = useState<1 | -1>(1)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const reload = async () => {
    setError('')
    try {
      const next = await getShopInventory(listing.id)
      setInventory(next)
      onSaved(next)
    } catch (reason) {
      setError(failure(reason))
    }
  }
  useEffect(() => {
    if (!listing.inventory) void reload()
    // The owner DTO is already authoritative when it includes inventory.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listing.id])
  const close = () => {
    if (!pending.current) onClose()
  }
  const parsed = Number(amount)
  const valid = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= 1000000
  return (
    <FadingDialog
      className={styles.dialog}
      aria-label="Adjust inventory"
      onRequestClose={close}
    >
      <header className={styles.row}>
        <h2>Adjust inventory</h2>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="Close inventory"
          disabled={busy}
          onClick={close}
        >
          <X size={20} />
        </button>
      </header>
      <p className={styles.muted}>{listing.title}</p>
      {!inventory && !error && <p role="status">Loading inventory...</p>}
      {inventory && (
        <p className={styles.muted}>
          {inventory.availableQuantity} available / {inventory.reservedQuantity}{' '}
          reserved / {inventory.onHandQuantity} on hand
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      <form
        onSubmit={async (event) => {
          event.preventDefault()
          if (!inventory || !valid || pending.current) return
          pending.current = true
          setBusy(true)
          setError('')
          try {
            const next = await adjustShopInventory(listing.id, {
              actionId: crypto.randomUUID(),
              delta: direction * parsed,
              expectedRevision: inventory.revision,
            })
            setInventory(next)
            onSaved(next)
            setAmount('1')
          } catch (reason) {
            setError(failure(reason))
          } finally {
            pending.current = false
            setBusy(false)
          }
        }}
      >
        <label className={styles.field}>
          Quantity
          <input
            inputMode="numeric"
            value={amount}
            disabled={!inventory || busy}
            onChange={(event) => setAmount(event.target.value)}
          />
        </label>
        <div className={styles.dialogActions}>
          {error && (
            <ShiningButton
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void reload()}
            >
              Reload inventory
            </ShiningButton>
          )}
          <ShiningButton
            type="button"
            variant={direction === -1 ? 'purple' : 'green'}
            disabled={busy}
            onClick={() => setDirection(-1)}
          >
            <Minus size={16} aria-hidden="true" />
            Decrease
          </ShiningButton>
          <ShiningButton
            type="button"
            variant={direction === 1 ? 'purple' : 'green'}
            disabled={busy}
            onClick={() => setDirection(1)}
          >
            <Plus size={16} aria-hidden="true" />
            Increase
          </ShiningButton>
          <ShiningButton
            type="submit"
            loading={busy}
            disabled={!inventory || !valid || busy}
          >
            Save adjustment
          </ShiningButton>
        </div>
      </form>
    </FadingDialog>
  )
}
