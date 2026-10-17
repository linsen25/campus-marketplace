import { useRouter } from 'next/router'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { Skeleton } from '@/components/ui/skeleton'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import { marketplaceRequest } from '@/lib/listings-api'
import { orderPaymentRole, stagingPaymentControl } from '@/lib/order-payment-ui'
import { formatOrderVisualAmount } from '@/lib/order-visual-preview'
import type { FormalOrder } from '@/types/order'

import { OrderCountdown } from './order-countdown'
import styles from './order-detail-preview.module.css'
import profile from './profile.module.css'

const payoutLabels = {
  not_eligible: 'Not eligible yet',
  pending: 'Pending',
  on_hold: 'On hold',
  eligible: 'Eligible',
  processing: 'Processing',
  paid: 'Paid',
  failed: 'Failed',
}
const methodLabels = {
  set: 'Set',
  unset: 'Not set',
  needs_attention: 'Needs attention',
}
const accountLabels = {
  ready: 'Ready',
  unset: 'Unset',
  needs_attention: 'Needs attention',
}
const futureLabels = {
  processing: 'Payment processing',
  failed: 'Payment failed',
  refunded: 'Payment refunded',
}

function Money({ rows }: { rows: Array<[string, number | null]> }) {
  return (
    <dl className={styles.amounts}>
      {rows
        .filter(([, amount]) => amount !== null)
        .map(([label, amount]) => (
          <div key={label} style={{ display: 'contents' }}>
            <dt>{label}</dt>
            <dd>{formatOrderVisualAmount(amount!)}</dd>
          </div>
        ))}
    </dl>
  )
}

// eslint-disable-next-line complexity -- Explicit role/status rendering keeps future financial states action-free; it does not advance the state machine.
export function FormalOrderPayment({
  order,
  userId,
  offset,
  onRefresh,
}: {
  order: FormalOrder
  userId: string
  offset: number
  onRefresh: () => Promise<void>
}) {
  const capabilities = useFinancialCapabilities()
  const router = useRouter()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  // This tracks an outstanding authoritative read, never a local financial status.
  const [awaitingRead, setAwaitingRead] = useState(false)
  const busy = useRef(false)
  const command = useRef<string>()
  const role = orderPaymentRole(order, userId)
  if (!role) return <p role="alert">Order not accessible.</p>
  const buyer = role === 'buyer'
  const paid = order.paymentStatus === 'paid'
  const expired = order.lifecycle === 'expired'
  const shippingPending = order.moneyStatus === 'shipping_pending'
  const paymentPending = order.paymentStatus === 'pending'
  const reserved =
    paymentPending &&
    !expired &&
    !shippingPending &&
    order.holdsListing &&
    Boolean(order.reservationExpiresAt)
  const method = capabilities.data?.paymentMethod
  const account = capabilities.data?.payoutAccount
  const ready = Boolean(method?.status === 'set' && !capabilities.error)
  const staging = stagingPaymentControl(order, userId)
  let title = buyer ? 'Payment pending' : 'Waiting for buyer payment'
  if (!paymentPending && !paid)
    title = futureLabels[order.paymentStatus as keyof typeof futureLabels]
  if (paid) title = buyer ? 'Payment confirmed' : 'Buyer payment confirmed'
  if (shippingPending) title = 'Shipping cost pending'
  if (expired) title = 'Reservation expired'
  const manage = () => {
    router.push('/home?section=settings&focus=payments-payouts').catch(() => {})
  }
  async function read() {
    await onRefresh()
    setAwaitingRead(false)
  }
  const simulate = async () => {
    if (busy.current || !ready || !staging || awaitingRead) return
    busy.current = true
    setPending(true)
    setError('')
    let succeeded = false
    try {
      command.current = command.current || crypto.randomUUID()
      // Ignore the mutation DTO: only a subsequent exact Order read renders Paid.
      await marketplaceRequest(
        `/api/orders/${encodeURIComponent(order.id)}/simulate-payment-success`,
        'POST',
        { clientActionId: command.current }
      )
      succeeded = true
      setAwaitingRead(true)
      await read()
      window.dispatchEvent(new Event('marketplace-orders-changed'))
    } catch (e) {
      let message = 'Unable to complete the payment test. Please retry.'
      if (e instanceof Error) message = e.message
      if (succeeded)
        message =
          'Payment test completed, but the latest Order could not be loaded. Refresh the Order to confirm its state.'
      setError(message)
      if (!succeeded) {
        await onRefresh().catch(() => {})
        await capabilities.refresh()
      }
      throw new Error('Payment test needs attention.')
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  return (
    <div className={styles.payment} data-payment-role={role}>
      <div>
        <h4>{title}</h4>
        {expired && (
          <p>
            {buyer
              ? 'No payment was completed.'
              : 'The buyer did not complete payment before the reservation ended.'}
          </p>
        )}
        {shippingPending && (
          <p>
            {buyer
              ? 'The seller still needs to provide the final shipping cost. Payment will become available after the shipping amount is finalized and confirmed.'
              : 'Payment cannot begin until the final shipping cost is agreed through the quote flow.'}
          </p>
        )}
        {buyer ? (
          <Money
            rows={
              paid
                ? [['Amount paid', order.totalAmount]]
                : [
                    ['Item price', order.itemAmount],
                    ['Shipping', order.shippingAmount],
                    ['Service fee', order.serviceFee],
                    ['Total', shippingPending ? null : order.totalAmount],
                  ]
            }
          />
        ) : (
          <>
            <dl className={styles.amounts}>
              <dt>Buyer payment</dt>
              <dd>
                {paid
                  ? 'Paid'
                  : order.paymentStatus.charAt(0).toUpperCase() +
                    order.paymentStatus.slice(1)}
              </dd>
            </dl>
            <h5>Your earnings</h5>
            <Money
              rows={[
                [
                  paid ? 'Buyer paid' : 'Order total',
                  shippingPending ? null : order.totalAmount,
                ],
                ['Item earnings', order.itemAmount],
                ['Seller platform fee', 0],
                ['Shipping reimbursement', order.shippingAmount],
                [
                  'Expected payout',
                  shippingPending || order.shippingAmount === null
                    ? null
                    : order.itemAmount + order.shippingAmount,
                ],
              ]}
            />
            <p>Your earnings exclude the Buyer Protection fee.</p>
            <dl className={styles.amounts}>
              <dt>Payout status</dt>
              <dd>{payoutLabels[order.payoutStatus]}</dd>
            </dl>
          </>
        )}
        {paid && order.paymentPaidAt && (
          <dl className={styles.amounts}>
            <dt>Paid at</dt>
            <dd>
              <time dateTime={order.paymentPaidAt}>
                {new Date(order.paymentPaidAt).toLocaleString()}
              </time>
            </dd>
          </dl>
        )}
        {reserved && (
          <>
            <p className={styles.countdown}>
              {buyer ? 'Reserved for you' : 'Waiting for buyer payment'}{' '}
              &middot;{' '}
              <OrderCountdown
                expiresAt={Date.parse(order.reservationExpiresAt!)}
                serverOffsetMs={offset}
                suffix="reservation remaining"
              />
            </p>
            <p>
              {buyer
                ? 'Complete payment before the reservation expires.'
                : 'The listing is reserved for this buyer. Do not hand over the item until payment is confirmed.'}
            </p>
          </>
        )}
        {paid && (
          <p>
            Payment has been confirmed. Continue with the Order&apos;s
            fulfillment step.
          </p>
        )}
      </div>
      <div className={styles.paymentAccount}>
        <h5>{buyer ? 'Payment method' : 'Payout account'}</h5>
        {capabilities.loading && !capabilities.data && (
          <Skeleton className="h-6 w-40" />
        )}
        {capabilities.error && <p role="alert">{capabilities.error}</p>}
        {buyer && method && (
          <>
            <p>{methodLabels[method.status]}</p>
            {method.status !== 'unset' && (method.brand || method.last4) && (
              <p>
                {method.brand}
                {method.last4 ? ` •••• ${method.last4}` : ''}
              </p>
            )}
            {paymentPending &&
              !expired &&
              !shippingPending &&
              method.status !== 'set' && (
                <CardAction variant="blue" onClick={manage}>
                  Manage payment method
                </CardAction>
              )}
          </>
        )}
        {!buyer && account && (
          <>
            <p>{accountLabels[account.status]}</p>
            {account.status !== 'unset' &&
              (account.institution || account.last4) && (
                <p>
                  {account.institution}
                  {account.last4 ? ` •••• ${account.last4}` : ''}
                </p>
              )}
            {account.status !== 'ready' && (
              <CardAction variant="blue" onClick={manage}>
                Review Payout Settings
              </CardAction>
            )}
          </>
        )}
        {capabilities.error && (
          <CardAction variant="blue" onClick={() => capabilities.refresh()}>
            Retry account status
          </CardAction>
        )}
        {paymentPending && !expired && !shippingPending && (
          <p className={profile.caption}>
            Payment integration is not enabled yet.
          </p>
        )}
        {staging && (!awaitingRead || pending) && (
          <aside
            className={styles.paymentTest}
            aria-label="Staging payment test"
          >
            <strong>STAGING ONLY</strong>
            <h5>Test payment state</h5>
            <p>
              Marks this staging Order as paid using the server-authoritative
              test path.
            </p>
            <StatefulButton
              disabled={pending || !ready}
              successText="Order refreshed"
              onClick={simulate}
            >
              Simulate successful payment
            </StatefulButton>
            {!ready && (
              <p>
                Set your account payment method in Payments &amp; payouts before
                running this test.
              </p>
            )}
          </aside>
        )}
        {awaitingRead && !pending && paymentPending && (
          <CardAction
            variant="blue"
            onClick={async () => {
              try {
                await read()
                setError('')
              } catch {
                setError('Unable to refresh the Order. Please retry.')
              }
            }}
          >
            Refresh Order
          </CardAction>
        )}
        {error && paymentPending && <p role="alert">{error}</p>}
      </div>
    </div>
  )
}
