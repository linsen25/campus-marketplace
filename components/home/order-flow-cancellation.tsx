import { ChevronDown } from 'lucide-react'
import { useId, useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import GlideSelect from '@/components/ui/GlideSelect'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import type { useOrderFlow } from '@/hooks/use-order-flow'
import { offerAmount } from '@/lib/offer-amount'
import { actOnOrderFlow } from '@/lib/order-flow-api'
import { cancelOrder } from '@/lib/orders-api'
import type { FormalOrder } from '@/types/order'

import workspace from '../listings/listing-workspace.module.css'

import pageStyles from './order-stage-page.module.css'
import profile from './profile.module.css'

/** The server projection owns availability, accepted intent and money disposition. */
// eslint-disable-next-line complexity -- Explicit role/fulfillment/cutoff/receipt branches keep settlement authority on the server.
export function OrderFlowCancellation({
  order,
  role,
  flow,
  onRefresh,
  onUpdated,
  onCancelled,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  flow: ReturnType<typeof useOrderFlow>
  onRefresh: () => Promise<void>
  onUpdated: (order: FormalOrder, serverTime: string) => void
  onCancelled: (order: FormalOrder, serverTime: string) => void
}) {
  const disclosureId = useId()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const lock = useRef(false)
  const needsRead = useRef(false)
  const command = useRef<{ digest: string; id: string }>()
  const state = flow.data?.fulfillment.cancellation
  const terms = order.v2!.terms
  const campus = terms.fulfillment === 'on_campus'
  const courier = !campus && terms.deliveryMethod === 'courier'
  const started = Boolean(state?.deliveryStartedAt)
  const refundRequest =
    role === 'buyer' && started && ['seller_fault', 'mutual'].includes(reason)
  const reconcile = async () => {
    await onRefresh()
    await flow.refresh()
    needsRead.current = false
    setAcknowledged(false)
    setError('')
  }
  const execute = async (response?: 'agree' | 'dispute') => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError('')
    try {
      if (needsRead.current) {
        await reconcile()
        return
      }
      const digest = JSON.stringify([response || 'cancel', reason, note.trim()])
      if (command.current?.digest !== digest)
        command.current = { digest, id: crypto.randomUUID() }
      if (response) {
        await actOnOrderFlow(order.id, 'respond-cancellation', {
          response,
          clientActionId: command.current.id,
        })
      } else if (refundRequest) {
        await actOnOrderFlow(order.id, 'request-cancellation', {
          reason,
          note: note.trim(),
          clientActionId: command.current.id,
        })
      } else {
        const result = await cancelOrder(
          order.id,
          reason,
          note.trim(),
          command.current.id
        )
        // A pending cancellation stays on this Order, rather than navigating to History.
        if (result.order.lifecycle === 'cancelled')
          onCancelled(result.order, result.serverTime)
        else onUpdated(result.order, result.serverTime)
      }
      setAcknowledged(true)
      setOpen(false)
      needsRead.current = true
      await reconcile()
      command.current = undefined
    } catch (failure) {
      needsRead.current = true
      try {
        await reconcile()
      } catch {
        /* Read before an uncertain write is retried. */
      }
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to refresh cancellation. Retry refreshing this Order.'
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  let explanation =
    'You can cancel until handoff is verified. A paid cancellation releases the item amount and Buyer Protection fee in full. No monetary cancellation penalty applies.'
  if (courier)
    explanation =
      'You can cancel before authoritative shipment. A paid cancellation releases the item amount, Delivery fee and Buyer Protection fee in full. After shipment, ordinary cancellation is closed.'
  else if (!campus && !started)
    explanation =
      'You can cancel before handoff. Before the Seller starts delivery, a paid cancellation releases the item amount, Delivery fee and Buyer Protection fee in full. No delivery compensation applies.'
  else if (!campus && role === 'buyer')
    explanation =
      'You can request cancellation before handoff. After delivery starts, an ordinary Buyer cancellation releases the item amount and Buyer Protection fee; the Delivery fee compensates the Seller. You may request a full refund for a Seller issue or mutual cancellation. Seller agreement resolves it; disagreement holds settlement for Case review.'
  else if (!campus)
    explanation =
      'You can cancel before handoff. If you cancel, the Buyer receives a full release including the Delivery fee; no delivery compensation applies. You may agree to a Buyer full-refund request or dispute it. Disputed settlement remains held for Case review.'
  if (order.lifecycle !== 'open')
    explanation =
      'This Order is closed. Normal cancellation is no longer available.'
  else if (
    flow.data?.fulfillment.handoffConfirmedAt ||
    flow.data?.fulfillment.protectionStartedAt
  )
    explanation =
      'Handoff or receipt has been confirmed. Normal cancellation is no longer available. Use Protection / Case if there is a problem.'
  else if (courier && flow.data?.courier?.shippedAt)
    explanation =
      'Shipment has been recorded. Normal cancellation is no longer available. Problems follow the shipment / Protection / Case flow.'
  if (order.v2?.terms.paymentMode === 'external' && order.lifecycle === 'open')
    explanation =
      flow.data?.fulfillment.externalExchange?.status &&
      flow.data.fulfillment.externalExchange.status !== 'awaiting_both'
        ? 'An external exchange has been attested. Ordinary cancellation and automatic inventory release are no longer available. UU cannot verify, reverse, refund, or protect external payments.'
        : 'You may cancel before either participant confirms the external exchange. UU did not process a payment and cannot issue a refund.'
  const options =
    role === 'buyer'
      ? [
          { value: 'buyer_changed_mind', label: 'Changed my mind' },
          { value: 'buyer_payment_issue', label: 'Payment issue' },
          { value: 'buyer_scheduling_issue', label: 'Scheduling issue' },
          { value: 'other', label: 'Other' },
        ]
      : [
          { value: 'seller_item_unavailable', label: 'Item unavailable' },
          { value: 'seller_scheduling_issue', label: 'Scheduling issue' },
          { value: 'seller_terms_issue', label: 'Terms need to change' },
          { value: 'other', label: 'Other' },
        ]
  if (role === 'buyer' && started && !courier)
    options.push(
      {
        value: 'seller_fault',
        label: 'Request full refund: Seller / item / delivery issue',
      },
      { value: 'mutual', label: 'Request mutual full-refund cancellation' }
    )
  const confirmationLabel = refundRequest
    ? 'Request full refund'
    : 'Confirm cancellation'
  const canReview =
    order.lifecycle === 'open' && Boolean(state?.canCancel) && !acknowledged
  const canRespond =
    order.lifecycle === 'open' &&
    state?.state === 'awaiting_seller' &&
    role === 'seller'
  return (
    <section className={profile.panel} aria-label="Cancel Order">
      <h4>Cancel order</h4>
      <p>{explanation}</p>
      {order.v2?.terms.paymentMode !== 'external' && (
        <p>
          After the cancellation cutoff, use the applicable Protection / Case
          path.
        </p>
      )}
      {order.lifecycle !== 'open' && (
        <p>This Order is closed. No normal cancellation action remains.</p>
      )}
      {flow.data?.fulfillment.handoffConfirmedAt && (
        <p>
          Handoff has been confirmed. Use Protection / Case if there is a
          problem.
        </p>
      )}
      {courier && flow.data?.courier?.shippedAt && (
        <p>Shipment has been recorded. Ordinary cancellation is closed.</p>
      )}
      {state?.state === 'payment_pending' && (
        <p>
          Cancellation pending. Payment is still being confirmed. You do not
          need to retry; any completed payment will follow the cancellation
          settlement automatically.
        </p>
      )}
      {state?.state === 'awaiting_seller' && (
        <>
          <p>
            Full-refund cancellation requested. Fulfillment is paused while the
            Seller responds.
          </p>
          {state.note && <p>{state.note}</p>}
        </>
      )}
      {state?.state === 'disputed' && (
        <p>
          Disputed settlement is held for Case review. No delivery compensation
          or sale payout is released.
        </p>
      )}
      {state?.settlement && (
        <p>
          Cancellation settlement authorized: Buyer release{' '}
          {offerAmount(state.settlement.buyerReleaseCents)}
          {state.settlement.sellerDeliveryCompensationCents > 0
            ? `; Seller delivery compensation ${offerAmount(
                state.settlement.sellerDeliveryCompensationCents
              )}`
            : ''}
          . Platform retains no Buyer Protection fee. Provider execution is not
          integrated.
        </p>
      )}
      {canReview && (
        <div className={pageStyles.cancelDisclosure}>
          <button
            type="button"
            disabled={busy}
            aria-expanded={open}
            aria-controls={disclosureId}
            onClick={() => setOpen((value) => !value)}
          >
            Review cancellation <ChevronDown size={16} aria-hidden={true} />
          </button>
        </div>
      )}
      {acknowledged && !state?.state && (
        <p>
          Cancellation request acknowledged. Refreshing authoritative Order
          state.
        </p>
      )}
      {!state && order.lifecycle === 'open' && (
        <p>Loading authoritative cancellation rules.</p>
      )}
      {(error || acknowledged || flow.error) && (
        <>
          <p role="alert">{error || flow.error}</p>
          <CardAction
            disabled={busy}
            onClick={() =>
              reconcile().catch(() =>
                setError('Unable to refresh. Please retry.')
              )
            }
          >
            Refresh Order
          </CardAction>
        </>
      )}
      {((open && canReview) || canRespond) && (
        <section
          id={disclosureId}
          className={pageStyles.cancelExpanded}
          aria-label="Cancellation review"
        >
          <h5>Cancellation consequences</h5>
          <p>
            {refundRequest
              ? 'This requests Seller agreement. Your selection does not establish fault or award a refund. A dispute holds settlement for Case review.'
              : explanation}
          </p>
          {canRespond ? (
            <>
              <p>
                Review the Buyer request. Agreement authorizes a full refund; a
                dispute holds settlement for Case review.
              </p>{' '}
              {role === 'seller' && (
                <ActionRow>
                  <CardAction
                    variant="green"
                    disabled={busy || acknowledged}
                    onClick={() => execute('agree')}
                  >
                    Agree to full refund
                  </CardAction>
                  <CardAction
                    variant="red"
                    disabled={busy || acknowledged}
                    onClick={() => execute('dispute')}
                  >
                    Dispute
                  </CardAction>
                </ActionRow>
              )}
            </>
          ) : (
            <>
              <fieldset disabled={busy}>
                <div className={workspace.field}>
                  <span>Cancellation context</span>
                  <GlideSelect
                    ariaLabel="Cancellation context"
                    options={options}
                    value={reason}
                    size="lg"
                    disabled={busy}
                    placeholder="Choose a reason"
                    onChange={setReason}
                  />
                </div>
                <label className={workspace.field}>
                  Note {reason === 'other' ? '(required)' : '(optional)'}
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </fieldset>
              {error && <p role="alert">{error}</p>}
              <div className={pageStyles.cancelAction}>
                <DynamicAction
                  variant="red"
                  disabled={
                    busy ||
                    acknowledged ||
                    !reason ||
                    (reason === 'other' && !note.trim())
                  }
                  onClick={() => execute()}
                >
                  {confirmationLabel}
                </DynamicAction>
              </div>
            </>
          )}
        </section>
      )}
    </section>
  )
}
