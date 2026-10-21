import { useRouter } from 'next/router'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { offerAmount } from '@/lib/offer-amount'
import { mutateCampusOrder } from '@/lib/orders-api'
import { getStripeClient } from '@/lib/stripe-client'
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
  showDetails = true,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  onRefresh: () => Promise<void>
  onUpdated: (order: FormalOrder, serverTime: string) => void
  showDetails?: boolean
}) {
  const router = useRouter()
  const capability = useFinancialCapabilities()
  const busy = useRef(false)
  const needsReconciliation = useRef(false)
  const command = useRef<{ action: string; key: string }>()
  const [blocked, setBlocked] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const payment = order.campusPayment
  const buyer = role === 'buyer'
  const active = order.lifecycle === 'open'
  const eligible = active && ['pending', 'failed'].includes(order.paymentStatus)
  const method = capability.data?.paymentMethod.status
  const refresh = async () => {
    try {
      await onRefresh()
      await capability.refresh()
      needsReconciliation.current = false
      setBlocked(false)
      setError('')
    } catch {
      setError('Unable to refresh. Retry refreshing the Order to recover.')
    }
  }
  async function act(action: 'payment') {
    if (busy.current) return
    if (needsReconciliation.current) {
      busy.current = true
      setRunning(true)
      setBlocked(true)
      try {
        await refresh()
      } finally {
        busy.current = false
        setRunning(false)
        setBlocked(false)
      }
      return
    }
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
      if (result.paymentConfirmation?.nextAction === 'confirm') {
        const stripe = await getStripeClient()
        if (!stripe)
          throw new Error('Secure payment confirmation is unavailable.')
        const confirmation = await stripe.confirmCardPayment(
          result.paymentConfirmation.clientSecret
        )
        if (confirmation.error)
          throw new Error(
            confirmation.error.type === 'card_error'
              ? 'Your card could not be confirmed. Review it and retry.'
              : 'Payment confirmation is uncertain. Refresh before retrying.'
          )
        if (
          !confirmation.paymentIntent ||
          confirmation.paymentIntent.id !==
            result.paymentConfirmation.paymentIntentId
        )
          throw new Error(
            'Payment confirmation is uncertain. Refresh before retrying.'
          )
        // Stripe.js is not Order payment evidence. B22 must reconcile the
        // bound PaymentIntent before the server can display Paid or Failed.
      } else if (!result.paymentConfirmation) {
        command.current = undefined
      }
      await onRefresh()
      setBlocked(false)
    } catch (e) {
      needsReconciliation.current = true
      await refresh()
      setError(
        e instanceof Error
          ? e.message
          : 'Unable to load the latest payment state.'
      )
      // Eligibility comes from the refreshed Order; an error does not permanently disable it.
    } finally {
      busy.current = false
      setRunning(false)
      setBlocked(false)
    }
  }
  let title = paymentTitles[order.paymentStatus]
  if (!buyer && order.paymentStatus === 'failed')
    title = 'Payment not completed'
  if (!active) title = 'Payment not completed'
  const pay = () => act('payment')
  const manage = () => {
    router.push('/home?section=settings&focus=payments-payouts').catch(() => {})
  }
  return (
    <section
      className={showDetails ? profile.panel : undefined}
      aria-label="Payment"
      data-campus-payment={order.paymentStatus}
    >
      <h4>{title}</h4>
      {!active && <p>This Order is closed. No payment was completed.</p>}
      {showDetails && active && !buyer && (
        <p>
          Waiting for Buyer payment. Fulfillment follows authoritative Payment
          confirmed; do not rely on screenshots, emails or chat claims.
        </p>
      )}
      {showDetails && active && buyer && (
        <p>
          Secure payment before meeting and inspecting the item. Payment does
          not confirm possession or release Seller payout.
        </p>
      )}
      {showDetails && payment && (
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
          Waiting for authoritative payment confirmation. Any accepted
          cancellation will be processed automatically when payment resolves.
        </p>
      )}
      {buyer && active && order.paymentStatus === 'processing' && (
        <CardAction disabled={blocked} onClick={pay}>
          Refresh payment
        </CardAction>
      )}
      {buyer && eligible && (
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
              {order.paymentStatus === 'failed' ? 'Retry payment' : 'Pay by UU'}
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
