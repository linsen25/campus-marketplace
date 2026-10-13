import { useRouter } from 'next/router'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { offerAmount } from '@/lib/offer-amount'
import { mutateCampusOrder } from '@/lib/orders-api'
import type { FormalOrder } from '@/types/order'

import detail from './order-detail-preview.module.css'
import profile from './profile.module.css'

const paymentTitles = {
  pending: 'Payment pending',
  processing: 'Payment processing',
  paid: 'Payment confirmed',
  failed: 'Payment failed',
  refunded: 'Payment refunded',
}

// Local state blocks repeated interaction while reconciling; it never supplies a status.
// eslint-disable-next-line complexity -- Explicit participant/payment branches do not advance transaction state.
export function OrderCampusPayment({
  order,
  role,
  onRefresh,
  onUpdated,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  onRefresh: () => Promise<void>
  onUpdated: (order: FormalOrder, serverTime: string) => void
}) {
  const router = useRouter()
  const capability = useFinancialCapabilities()
  const busy = useRef(false)
  const command = useRef<{ action: string; key: string }>()
  const [blocked, setBlocked] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const payment = order.campusPayment
  const buyer = role === 'buyer'
  const active = order.lifecycle === 'open'
  const eligible = active && ['pending', 'failed'].includes(order.paymentStatus)
  const inspected = Boolean(payment?.inspectionConfirmedAt)
  const method = capability.data?.paymentMethod.status
  const refresh = async () => {
    try {
      await onRefresh()
      await capability.refresh()
      setBlocked(false)
      setError('')
    } catch {
      setError(
        'Unable to refresh. Actions remain unavailable until the Order can be loaded.'
      )
    }
  }
  async function act(action: 'inspection' | 'payment') {
    const reconciling =
      action === 'payment' &&
      order.lifecycle === 'open' &&
      order.paymentStatus === 'processing'
    if (busy.current || blocked || !buyer || (!eligible && !reconciling)) return
    busy.current = true
    setRunning(true)
    setBlocked(true)
    setError('')
    if (command.current?.action !== action)
      command.current = { action, key: crypto.randomUUID() }
    try {
      const result = await mutateCampusOrder(
        order.id,
        action,
        command.current.key
      )
      onUpdated(result.order, result.serverTime)
      command.current = undefined
      await onRefresh()
      setBlocked(false)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to load the latest payment state.'
      )
      if (action === 'payment') await capability.refresh()
      // A transport failure may follow a committed mutation. Never restore eligibility blindly.
    } finally {
      busy.current = false
      setRunning(false)
    }
  }
  let title = paymentTitles[order.paymentStatus]
  if (!buyer && order.paymentStatus === 'failed')
    title = 'Payment not completed'
  if (!active) title = 'Payment not completed'
  const inspect = () => act('inspection')
  const pay = () => act('payment')
  const manage = () => {
    router.push('/home?section=settings&focus=payments-payouts').catch(() => {})
  }
  return (
    <section
      className={profile.panel}
      aria-label="Payment"
      data-campus-payment={order.paymentStatus}
    >
      <h4>{title}</h4>
      {!active && <p>This Order is closed. No payment was completed.</p>}
      {active && !buyer && (
        <p>
          Meet the Buyer and allow them to inspect the item. Verify Payment
          confirmed in this Marketplace Order; do not rely on screenshots,
          emails or chat claims.
        </p>
      )}
      {active && !buyer && inspected && (
        <p>
          The Buyer has inspected the item and chosen to continue to payment.
        </p>
      )}
      {active && buyer && inspected && (
        <p>You chose to continue after inspecting the item.</p>
      )}
      {active && buyer && !inspected && (
        <p>
          Confirm that you have inspected the item and want to continue to
          payment. This does not charge you.
        </p>
      )}
      {payment && (
        <dl className={detail.amounts}>
          <dt>Item price</dt>
          <dd>{offerAmount(payment.itemCents)}</dd>
          {buyer && (
            <>
              <dt>Service fee</dt>
              <dd>{offerAmount(payment.feeCents)}</dd>
              <dt>Total</dt>
              <dd>{offerAmount(payment.totalCents)}</dd>
            </>
          )}
          {!buyer && (
            <>
              <dt>Seller platform fee</dt>
              <dd>{offerAmount(0)}</dd>
              <dt>Item earnings</dt>
              <dd>{offerAmount(payment.itemCents)}</dd>
              <dt>Payout</dt>
              <dd>Not eligible yet</dd>
            </>
          )}
        </dl>
      )}
      {order.paymentStatus === 'paid' && (
        <p>
          Payment is confirmed. Keep the item with the Seller until the
          Marketplace handoff step is completed.
        </p>
      )}
      {order.paymentStatus === 'processing' && (
        <p>
          Waiting for authoritative payment confirmation. Cancellation and
          no-show settlement are blocked while payment resolves.
        </p>
      )}
      {buyer && active && order.paymentStatus === 'processing' && (
        <CardAction disabled={blocked} onClick={pay}>
          Refresh payment
        </CardAction>
      )}
      {buyer && eligible && !inspected && (
        <CardAction variant="green" disabled={blocked} onClick={inspect}>
          Continue to payment
        </CardAction>
      )}
      {buyer && eligible && inspected && (
        <>
          {method !== 'set' || capability.error ? (
            <>
              <p>
                {method === 'needs_attention'
                  ? 'Your payment method needs attention.'
                  : 'Set up a payment method before paying.'}
              </p>
              <CardAction onClick={manage}>Payments Settings</CardAction>
            </>
          ) : (
            <CardAction variant="green" disabled={blocked} onClick={pay}>
              {order.paymentStatus === 'failed'
                ? 'Retry test payment'
                : 'Pay (staging test)'}
            </CardAction>
          )}
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {(error || blocked) && (
        <CardAction disabled={running} onClick={refresh}>
          Refresh Order
        </CardAction>
      )}
    </section>
  )
}
