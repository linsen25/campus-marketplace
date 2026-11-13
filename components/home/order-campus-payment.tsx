import { useRouter } from 'next/router'
import { useCallback, useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { PaymentUnavailableDialog } from '@/components/home/payment-unavailable-dialog'
import { StripeOrderPayment } from '@/components/payments/stripe-order-payment'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { offerAmount } from '@/lib/offer-amount'
import { mutateCampusOrder } from '@/lib/orders-api'
import { findConversation } from '@/lib/messages-api'
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
  const refreshCapabilities = capability.refresh
  const busy = useRef(false)
  const needsReconciliation = useRef(false)
  const command = useRef<{ action: string; key: string }>()
  const [blocked, setBlocked] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState('')
  const [paymentPanel, setPaymentPanel] = useState(false)
  const [sellerPaymentBlocked, setSellerPaymentBlocked] = useState(false)
  const [contactingSeller, setContactingSeller] = useState(false)
  const payment = order.campusPayment
  const buyer = role === 'buyer'
  const active = order.lifecycle === 'open'
  const eligible = active && ['pending', 'failed'].includes(order.paymentStatus)
  const method = capability.data?.paymentMethod.status
  const refresh = useCallback(async () => {
    try {
      await onRefresh()
      await refreshCapabilities()
      needsReconciliation.current = false
      setBlocked(false)
      setError('')
    } catch {
      setError('Unable to refresh. Retry refreshing the Order to recover.')
    }
  }, [refreshCapabilities, onRefresh])
  const preparePayment = useCallback(async () => {
    if (busy.current || !buyer || !eligible)
      throw new Error('Payment is not available for this Order.')
    busy.current = true
    setRunning(true)
    setBlocked(true)
    setError('')
    command.current = command.current || {
      action: 'payment',
      key: crypto.randomUUID(),
    }
    try {
      const result = await mutateCampusOrder(
        order.id,
        'payment',
        command.current.key
      )
      onUpdated(result.order, result.serverTime)
      if (
        !result.paymentConfirmation ||
        result.paymentConfirmation.nextAction !== 'confirm'
      )
        throw new Error(
          'Payment is already being confirmed. Refresh the Order before retrying.'
        )
      return {
        clientSecret: result.paymentConfirmation.clientSecret,
        paymentIntentId: result.paymentConfirmation.paymentIntentId,
      }
    } catch (e) {
      needsReconciliation.current = true
      await refresh()
      const errorCode =
        e && typeof e === 'object' ? (e as { code?: unknown }).code : undefined
      if (errorCode === 'seller_payout_not_ready') {
        setPaymentPanel(false)
        setSellerPaymentBlocked(true)
        setBlocked(false)
        setError('')
        throw e
      }
      const message =
        e instanceof Error ? e.message : 'Unable to prepare payment.'
      setError(message)
      throw e
    } finally {
      busy.current = false
      setRunning(false)
    }
  }, [buyer, eligible, onUpdated, order.id, refresh])
  let title = paymentTitles[order.paymentStatus]
  if (!buyer && order.paymentStatus === 'failed')
    title = 'Payment not completed'
  if (!active) title = 'Payment not completed'
  const pay = () => {
    if (order.paymentStatus === 'processing') return refresh()
    setPaymentPanel(true)
  }
  const closePayment = () => {
    setPaymentPanel(false)
    setBlocked(false)
  }
  const manage = () => {
    router.push('/home?section=settings&focus=payments-payouts').catch(() => {})
  }
  const contactSeller = async () => {
    if (contactingSeller) return
    setContactingSeller(true)
    try {
      const conversation = await findConversation(
        order.listingId,
        order.listingProvenance?.channel === 'shop'
      )
      await router.push(
        `/home?section=messages&destination=${conversation.role}&conversation=${conversation.id}`
      )
    } catch {
      setError('Unable to contact the seller. Please try again.')
    } finally {
      setContactingSeller(false)
    }
  }
  return (
    <>
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
                {order.paymentStatus === 'failed'
                  ? 'Retry payment'
                  : 'Pay by UU'}
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
      {paymentPanel && (
        <FadingDialog
          className={profile.dialog}
          aria-labelledby="stripe-order-payment-title"
          onRequestClose={closePayment}
        >
          <h3 id="stripe-order-payment-title">Complete payment</h3>
          <p className={profile.caption}>
            Secure CAD payment powered by Stripe. Payment does not release
            Seller funds.
          </p>
          <StripeOrderPayment
            prepare={preparePayment}
            onCancel={closePayment}
            onComplete={async () => {
              await onRefresh()
              setPaymentPanel(false)
              setBlocked(false)
              window.dispatchEvent(new Event('marketplace-orders-changed'))
            }}
          />
        </FadingDialog>
      )}
      {sellerPaymentBlocked && (
        <PaymentUnavailableDialog
          busy={contactingSeller}
          onClose={() => setSellerPaymentBlocked(false)}
          onContact={contactSeller}
        />
      )}
    </>
  )
}
