import { AnimatePresence } from 'framer-motion'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import GlideSelect from '@/components/ui/GlideSelect'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { cancelOrder } from '@/lib/orders-api'
import type { FormalOrder } from '@/types/order'

import workspace from '../listings/listing-workspace.module.css'

import cancellationStyles from './order-cancellation.module.css'
import styles from './order-request-preview.module.css'
import profile from './profile.module.css'

const reasons = {
  buyer: [
    ['buyer_changed_mind', 'Changed my mind'],
    ['buyer_payment_issue', "Can't complete payment"],
    ['buyer_scheduling_issue', 'Scheduling issue'],
    ['buyer_terms_issue', 'Item or terms no longer work for me'],
    ['other', 'Other'],
  ],
  seller: [
    ['seller_item_unavailable', 'Item no longer available'],
    ['seller_scheduling_issue', 'Scheduling issue'],
    ['buyer_requested_cancellation', 'Buyer requested cancellation'],
    ['seller_terms_issue', 'Terms need to change'],
    ['other', 'Other'],
  ],
}

function cancellationHistory(order: FormalOrder, showHistory?: boolean) {
  return showHistory !== false && order.lifecycle === 'cancelled'
    ? order.cancellation
    : null
}

export function OrderCancellation({
  order,
  role,
  offset,
  onRefresh,
  onCancelled,
  showHistory,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  offset: number
  onRefresh: () => Promise<void>
  onCancelled: (order: FormalOrder, serverTime: string) => void
  showHistory?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  // A successful response is authoritative. Keep the action locked even if refetch fails.
  const [confirmed, setConfirmed] = useState<FormalOrder | null>(null)
  const lock = useRef(false)
  const command = useRef<{ digest: string; key: string }>()
  const current = confirmed || order
  const history = cancellationHistory(current, showHistory)
  const cancellable =
    current.lifecycle === 'open' &&
    ['pending', 'failed'].includes(current.paymentStatus) &&
    !current.paymentPaidAt &&
    (current.protocolVersion === 2 ||
      !current.holdsListing ||
      (Boolean(current.reservationExpiresAt) &&
        Date.parse(current.reservationExpiresAt!) > Date.now() + offset))
  const close = () => {
    if (!lock.current) setOpen(false)
  }
  const submit = async () => {
    if (
      lock.current ||
      !cancellable ||
      !reason ||
      (reason === 'other' && !note.trim())
    )
      return
    lock.current = true
    setBusy(true)
    setError('')
    const digest = JSON.stringify([order.id, reason, note.trim()])
    if (command.current?.digest !== digest)
      command.current = { digest, key: crypto.randomUUID() }
    try {
      const result = await cancelOrder(
        order.id,
        reason,
        note.trim(),
        command.current.key
      )
      setConfirmed(result.order)
      onCancelled(result.order, result.serverTime)
      setOpen(false)
      window.dispatchEvent(new Event('marketplace-orders-changed'))
      try {
        await onRefresh()
      } catch {
        setError('Order cancelled. Unable to refresh the view. Please retry.')
      }
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to cancel. Please retry.'
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section aria-label="Order cancellation">
      {history && (
        <div className={profile.panel}>
          <h4>Order cancelled</h4>
          <dl className={styles.summary}>
            <dt>Cancelled by</dt>
            <dd>{history.byRole === 'buyer' ? 'Buyer' : 'Seller'}</dd>
            <dt>Reason</dt>
            <dd>{history.reason}</dd>
            {history.note && (
              <>
                <dt>Note</dt>
                <dd>{history.note}</dd>
              </>
            )}
            <dt>Cancelled at</dt>
            <dd>
              <time dateTime={history.at}>
                {new Date(history.at).toLocaleString()}
              </time>
            </dd>
          </dl>
        </div>
      )}
      {cancellable && (
        <CardAction variant="red" onClick={() => setOpen(true)}>
          Cancel order
        </CardAction>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <CardAction
            onClick={async () => {
              try {
                await onRefresh()
                setError('')
              } catch {
                setError('Unable to refresh the view. Please retry.')
              }
            }}
          >
            Refresh order
          </CardAction>
        </div>
      )}
      <AnimatePresence>
        {open && (
          <FadingDialog
            className={`${workspace.confirmation} ${cancellationStyles.dialog}`}
            aria-labelledby="cancel-order-title"
            onRequestClose={close}
          >
            <h3 id="cancel-order-title">Cancel this order?</h3>
            <p>
              The order will be cancelled and any active unpaid reservation will
              be released.
            </p>
            <fieldset disabled={busy}>
              <div className={workspace.field}>
                <span>Cancellation reason</span>
                <GlideSelect
                  ariaLabel="Cancellation reason"
                  options={reasons[role].map(([value, label]) => ({
                    value,
                    label,
                  }))}
                  value={reason}
                  placeholder="Choose a reason"
                  size="lg"
                  disabled={busy}
                  surfaceColor="#160f1d"
                  highlightColor="#403047"
                  accentColor="#b995dc"
                  onChange={setReason}
                />
              </div>
              <label className={workspace.field}>
                {reason === 'other' ? 'Note (required)' : 'Optional note'}
                <textarea
                  rows={3}
                  maxLength={1000}
                  required={reason === 'other'}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                />
              </label>
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <ActionRow>
              <CardAction variant="green" disabled={busy} onClick={close}>
                Keep order
              </CardAction>
              <CardAction
                variant="red"
                disabled={
                  busy || !reason || (reason === 'other' && !note.trim())
                }
                aria-busy={busy}
                onClick={submit}
              >
                {busy ? 'Cancelling...' : 'Cancel order'}
              </CardAction>
            </ActionRow>
          </FadingDialog>
        )}
      </AnimatePresence>
    </section>
  )
}
