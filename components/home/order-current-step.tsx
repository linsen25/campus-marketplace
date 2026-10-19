import { ArrowRight } from 'lucide-react'
import { useRouter } from 'next/router'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import GlideSelect from '@/components/ui/GlideSelect'
import { StatefulButton } from '@/components/velora/stateful-button'
import { useFinancialCapabilities } from '@/hooks/use-financial-capabilities'
import type { useOrderFlow } from '@/hooks/use-order-flow'
import { HandoffError } from '@/lib/handoff'
import type { CurrentOrderStep } from '@/lib/order-current-step'
import { actOnOrderFlow } from '@/lib/order-flow-api'
import type { FormalOrder } from '@/types/order'

import workspace from '../listings/listing-workspace.module.css'

import { BuyerHandoffCredential } from './handoff-credential'
import { HandoffScanner } from './handoff-scanner'
import { HandoffVerification } from './handoff-verification'
import { OrderCampusPayment } from './order-campus-payment'
import styles from './order-detail-preview.module.css'
import { CourierShipmentForm, DeliveryAddressForm } from './order-flow-actions'
import pageStyles from './order-stage-page.module.css'
import profile from './profile.module.css'

const cancellationCopy: Record<string, string> = {
  disputed:
    'Cancellation is disputed. Settlement is held for Case review; fulfillment and payout cannot proceed.',
  awaiting_seller:
    'Full-refund cancellation requested. Waiting for the Seller response; fulfillment is paused.',
  payment_pending:
    'Cancellation requested. Payment is still being confirmed. You do not need to retry. If payment completes, cancellation settlement will be authorized automatically.',
  finalized: 'Cancellation settlement authorized. Refreshing the closed Order.',
}
const handoffCopy = {
  on_campus: {
    buyer:
      'Meet the Seller at the confirmed location and time. Inspect the item. Only present your handoff credential if satisfied.',
    seller:
      'Meet the Buyer at the confirmed location and time. Allow inspection, then verify the Buyer-held credential.',
  },
  delivery: {
    buyer:
      'Inspect the delivered item. Only present your handoff credential if satisfied.',
    seller:
      'Deliver to the agreed destination. Allow Buyer inspection, then verify the Buyer-held credential.',
  },
}

export function PrivateAddress({
  address,
}: {
  address: NonNullable<ReturnType<typeof useOrderFlow>['data']>['checkout']
}) {
  if (!address?.address) return null
  const value = address.address
  return (
    <section aria-label="Delivery destination">
      <h5>Delivery destination</h5>
      <p>{value.recipient_name}</p>
      <p>
        {value.street}
        {value.unit ? ` · ${value.unit}` : ''}
      </p>
      <p>
        {value.city}, {value.province_code} · {value.postal_code}
      </p>
    </section>
  )
}

function BuyerDeliveryPayment({
  blocked,
  onPay,
}: {
  blocked: boolean
  onPay: () => Promise<void>
}) {
  const router = useRouter()
  const capability = useFinancialCapabilities()
  if (capability.loading) return <p role="status">Loading payment method…</p>
  if (capability.error || capability.data?.paymentMethod.status !== 'set')
    return (
      <>
        <p>
          Set up your payment method in Payments &amp; payouts before paying.
        </p>
        <CardAction
          onClick={() =>
            router
              .push('/home?section=settings&focus=payments-payouts')
              .catch(() => {})
          }
        >
          Payments Settings
        </CardAction>
      </>
    )
  return (
    <StatefulButton
      className={pageStyles.primaryAction}
      disabled={blocked}
      onClick={onPay}
    >
      Pay
    </StatefulButton>
  )
}

// eslint-disable-next-line complexity -- Explicit authoritative stage and participant branches; no local lifecycle transitions.
export function OrderCurrentStep({
  order,
  role,
  stage,
  readOnly = false,
  stageTitle,
  flow,
  onRefresh,
  onUpdated,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  flow: ReturnType<typeof useOrderFlow>
  stage: CurrentOrderStep
  readOnly?: boolean
  stageTitle?: string
  onRefresh: () => Promise<void>
  onUpdated: (order: FormalOrder, serverTime: string) => void
}) {
  const [blocked, setBlocked] = useState(false)
  const [error, setError] = useState('')
  const [addressDirty, setAddressDirty] = useState(false)
  const [reason, setReason] = useState('')
  const [scannerOpen, setScannerOpen] = useState(false)
  const [numericRetryAt, setNumericRetryAt] = useState<string>()
  const busy = useRef(false)
  const needsReconciliation = useRef(false)
  const command = useRef<{ digest: string; id: string }>()
  const data = flow.data
  const terms = order.v2!.terms
  const buyer = role === 'buyer'
  const refresh = async () => {
    await onRefresh()
    await flow.refresh()
    needsReconciliation.current = false
    setBlocked(false)
    setError('')
  }
  // eslint-disable-next-line complexity -- Role, payment and cancellation fences are independent safety checks.
  const act = async (
    action: Parameters<typeof actOnOrderFlow>[1],
    body: Record<string, unknown> = {}
  ) => {
    if (busy.current || readOnly) return
    // An uncertain receipt is recoverable, but never a reason to repeat a write blindly.
    if (needsReconciliation.current) {
      busy.current = true
      setBlocked(true)
      try {
        await refresh()
        throw new Error(
          'Order refreshed. Review the current step before retrying.'
        )
      } finally {
        busy.current = false
        setBlocked(false)
      }
    }
    const sellerAction =
      action === 'handoff' ||
      action === 'shipment' ||
      action === 'start-delivery'
    const paidAction =
      sellerAction || action === 'received' || action === 'case'
    if (
      busy.current ||
      blocked ||
      !data ||
      Boolean(data?.fulfillment.cancellation?.state) ||
      order.lifecycle !== 'open' ||
      (!['confirm-agreement', 'confirm-exchange', 'dispute-exchange'].includes(
        action
      ) &&
        sellerAction === buyer) ||
      (paidAction && order.paymentStatus !== 'paid')
    )
      return
    if (
      !paidAction &&
      action !== 'confirm-agreement' &&
      !['pending', 'failed'].includes(order.paymentStatus)
    )
      return
    busy.current = true
    setBlocked(true)
    setError('')
    try {
      // Fingerprint the existing idempotency intent without retaining raw credentials.
      const input = JSON.stringify([action, body])
      const digest =
        action === 'handoff'
          ? Array.from(
              new Uint8Array(
                await crypto.subtle.digest(
                  'SHA-256',
                  new TextEncoder().encode(input)
                )
              ),
              (value) => value.toString(16).padStart(2, '0')
            ).join('')
          : input
      if (command.current?.digest !== digest)
        command.current = { digest, id: crypto.randomUUID() }
      await actOnOrderFlow(order.id, action, {
        ...body,
        ...(!['address', 'checkout', 'confirm-agreement'].includes(action)
          ? { clientActionId: command.current.id }
          : {}),
      })
      // A write receipt is not a locally fabricated final Order state.
      await refresh()
      command.current = undefined
    } catch (failure) {
      if (
        action === 'handoff' &&
        failure instanceof HandoffError &&
        failure.code === 'numeric_temporarily_locked'
      )
        setNumericRetryAt(failure.retryAt)
      needsReconciliation.current = true
      try {
        await refresh()
        if (
          action === 'handoff' &&
          failure instanceof HandoffError &&
          failure.code === 'handoff_already_redeemed'
        ) {
          command.current = undefined
          return
        }
      } catch {
        // The retry/Refresh entry point will reconcile before another mutation.
      }
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to refresh this operation. Refresh the Order before retrying.'
      )
      throw failure
    } finally {
      busy.current = false
      setBlocked(false)
    }
  }
  const titles = {
    cancelled: 'Order cancelled',
    cancellation: 'Cancellation pending',
    delivery: buyer ? 'Waiting for Seller delivery' : 'Prepare delivery',
    checkout: buyer
      ? 'Delivery checkout'
      : 'Waiting for Buyer checkout / payment',
    completed: 'Completed',
    expired: 'Order expired',
    exchange: 'Confirm exchange',
    handoff: buyer ? 'Inspect / Handoff' : 'Fulfillment / Verify Buyer handoff',
    inspect: buyer ? 'Meet / Inspect item' : 'Waiting for Buyer inspection',
    loading: 'Loading current step…',
    payment: buyer ? 'Payment' : 'Waiting for Buyer payment',
    protection: 'Protection',
    review: 'Agreement',
    shipment: buyer ? 'Waiting for shipment / receipt' : 'Courier fulfillment',
  }
  const instructions: Record<CurrentOrderStep, string> = {
    exchange:
      'Confirm only after you have personally completed the direct exchange.',
    review:
      'Review your agreement. Check the confirmed transaction terms before proceeding.',
    payment: buyer
      ? 'Secure payment before fulfillment continues.'
      : 'Waiting for Buyer payment.',
    checkout: buyer
      ? 'Provide your private delivery address and secure payment before fulfillment continues.'
      : 'Waiting for Buyer checkout / payment.',
    handoff:
      handoffCopy[terms.fulfillment === 'on_campus' ? 'on_campus' : 'delivery'][
        role
      ],
    inspect: handoffCopy.on_campus[role],
    delivery: buyer
      ? 'Waiting for the Seller to start delivery. Inspect the item on arrival.'
      : 'Payment is secured. Start delivery when you begin the delivery effort.',
    shipment: buyer
      ? 'Wait for shipment. Confirm receipt only after receiving the item.'
      : 'Ship to the authorized destination after payment is secured.',
    protection: buyer
      ? 'Review the received item during Protection. Completion follows the authoritative deadline and Case state.'
      : 'Wait for Protection to complete. Payout eligibility follows the authoritative Protection deadline and Case state.',
    completed: 'Completed. No transaction action remains.',
    cancelled: 'No further transaction action is available.',
    expired: 'No further transaction action is available.',
    loading: '',
    cancellation: '',
  }
  if (terms.paymentMode === 'external' && stage === 'inspect')
    instructions.inspect =
      'Meet at the agreed location and time. Inspect the item before confirming the direct exchange.'
  if (stage === 'shipment' && data?.courier?.state === 'shipped') {
    titles.shipment = buyer
      ? 'Confirm receipt'
      : 'Waiting for delivery / receipt'
    instructions.shipment = buyer
      ? 'Confirm receipt only after you have received the item. Shipment alone is not possession.'
      : 'Waiting for trusted delivery or Buyer confirmation of receipt.'
  }
  return (
    <>
      <section
        className={`${profile.panel} ${pageStyles.currentStep}`}
        aria-label="Current Step"
        data-current-step={stage}
      >
        <p className={styles.eyebrow}>Current Step</p>
        <h4 className={styles.currentStepTitle}>
          {stageTitle || titles[stage]}
        </h4>
        <p>
          {readOnly
            ? 'Review this recorded stage. Completed transaction facts are read-only.'
            : instructions[stage]}
        </p>
        {order.v2?.terms.paymentMode === 'external' && stage !== 'review' && (
          <>
            <p>Paid outside UU · No UU payment protection</p>
            <p>
              Payments made outside UU are arranged directly between buyer and
              seller. UU cannot verify, reverse, refund, or provide payment
              protection for external payments.
            </p>
            {stage === 'inspect' && (
              <p>
                Meet at the agreed location and time. Inspect the item before
                proceeding to Confirm exchange.
              </p>
            )}
            {stage === 'exchange' &&
              data?.fulfillment.externalExchange &&
              (() => {
                const exchange = data.fulfillment.externalExchange
                const own = buyer
                  ? exchange.buyerConfirmedAt
                  : exchange.sellerConfirmedAt
                const other = buyer
                  ? exchange.sellerConfirmedAt
                  : exchange.buyerConfirmedAt
                if (exchange.status === 'disputed')
                  return (
                    <p role="status">
                      External exchange disputed. The Listing remains held. This
                      report does not create UU payment protection or a
                      financial settlement.
                    </p>
                  )
                return (
                  <>
                    {own ? (
                      <p role="status">
                        You confirmed the exchange. Waiting for the{' '}
                        {buyer ? 'seller' : 'buyer'} to confirm.
                      </p>
                    ) : (
                      <>
                        {other && (
                          <p>
                            The {buyer ? 'seller' : 'buyer'} confirmed the
                            exchange. Confirm only if you completed your part of
                            the exchange.
                          </p>
                        )}
                        <p>
                          {buyer
                            ? 'I paid the seller directly and received the item.'
                            : 'I received payment directly and handed over the item.'}
                        </p>
                        {!readOnly && (
                          <StatefulButton
                            className={workspace.statefulForward}
                            disabled={blocked}
                            onClick={() => act('confirm-exchange')}
                          >
                            Confirm exchange{' '}
                            <ArrowRight size={16} aria-hidden={true} />
                          </StatefulButton>
                        )}
                        {other && !readOnly && (
                          <label>
                            Exchange did not occur
                            <input
                              value={reason}
                              maxLength={1000}
                              placeholder="Describe the disagreement"
                              onChange={(event) =>
                                setReason(event.target.value)
                              }
                            />
                            <StatefulButton
                              disabled={blocked || !reason.trim()}
                              onClick={() =>
                                act('dispute-exchange', {
                                  reason: reason.trim(),
                                })
                              }
                            >
                              Report disagreement
                            </StatefulButton>
                          </label>
                        )}
                      </>
                    )}
                  </>
                )
              })()}
          </>
        )}
        {stage === 'review' && !readOnly && data?.fulfillment.agreement && (
          <>
            {data.fulfillment.agreement.complete ? (
              <p>Both parties have confirmed the frozen Agreement.</p>
            ) : (
              <>
                <p>
                  Buyer:{' '}
                  {data.fulfillment.agreement.buyerConfirmedAt
                    ? 'Confirmed'
                    : 'Not confirmed'}
                  . Seller:{' '}
                  {data.fulfillment.agreement.sellerConfirmedAt
                    ? 'Confirmed'
                    : 'Not confirmed'}
                  .
                </p>
                {(
                  buyer
                    ? data.fulfillment.agreement.buyerConfirmedAt
                    : data.fulfillment.agreement.sellerConfirmedAt
                ) ? (
                  <p role="status">
                    Agreement confirmed. Waiting for the{' '}
                    {buyer ? 'Seller' : 'Buyer'} to confirm.
                  </p>
                ) : (
                  <StatefulButton
                    className={pageStyles.primaryAction}
                    disabled={blocked}
                    onClick={() => act('confirm-agreement')}
                  >
                    Confirm Agreement
                  </StatefulButton>
                )}
              </>
            )}
          </>
        )}
        {stage === 'loading' && !flow.error && (
          <p role="status">Loading authoritative transaction information.</p>
        )}
        {stage === 'cancellation' && (
          <p>
            {
              cancellationCopy[
                data?.fulfillment.cancellation?.state || 'payment_pending'
              ]
            }
          </p>
        )}
        {!readOnly &&
          ![
            'review',
            'completed',
            'cancelled',
            'expired',
            'loading',
            'cancellation',
            'exchange',
            'inspect',
          ].includes(stage) && (
            <section
              className={profile.panel}
              aria-label="Current-stage actions"
            >
              {stage === 'payment' &&
                (terms.fulfillment === 'on_campus' ? (
                  <OrderCampusPayment
                    order={order}
                    role={role}
                    showDetails={false}
                    onRefresh={refresh}
                    onUpdated={onUpdated}
                  />
                ) : (
                  <p>
                    Waiting for authoritative payment confirmation. Handoff is
                    not available yet.
                  </p>
                ))}
              {stage === 'checkout' && data?.checkout && (
                <>
                  <p>
                    {buyer
                      ? 'Provide your private delivery address and pay before the payment deadline.'
                      : 'The Buyer must provide their address and complete payment. You can see only the agreed coarse area until Paid.'}
                  </p>
                  {buyer && !data.checkout.checkoutStartedAt && (
                    <StatefulButton
                      className={pageStyles.primaryAction}
                      disabled={blocked}
                      onClick={() => act('checkout')}
                    >
                      Start checkout
                    </StatefulButton>
                  )}
                  {buyer &&
                    data.checkout.checkoutStartedAt &&
                    !data.checkout.addressFrozen &&
                    terms.fulfillment === 'delivery' &&
                    terms.deliveryArea && (
                      <DeliveryAddressForm
                        disabled={blocked}
                        initial={data.checkout.address}
                        area={terms.deliveryArea}
                        onDirty={setAddressDirty}
                        onSave={(address) => act('address', { address })}
                      />
                    )}
                  {buyer &&
                    data.checkout.checkoutStartedAt &&
                    data.checkout.address &&
                    !addressDirty && (
                      <BuyerDeliveryPayment
                        blocked={blocked}
                        onPay={() => act('payment')}
                      />
                    )}
                </>
              )}
              {stage === 'handoff' &&
                order.paymentStatus === 'paid' &&
                (terms.fulfillment === 'on_campus' ||
                  (terms.deliveryMethod === 'seller_delivery' &&
                    data?.fulfillment.deliveryStartedAt)) && (
                  <>
                    {buyer ? (
                      <BuyerHandoffCredential
                        key={order.id}
                        orderId={order.id}
                        credential={data?.credential}
                      />
                    ) : (
                      <>
                        {data?.fulfillment.handoffReady ? (
                          <>
                            <HandoffVerification
                              disabled={blocked}
                              numericRetryAt={numericRetryAt}
                              onOpenScanner={() => setScannerOpen(true)}
                              onVerify={(code) =>
                                act('handoff', {
                                  channel: 'code',
                                  credential: code,
                                })
                              }
                            />
                            {scannerOpen && (
                              <HandoffScanner
                                key={order.id}
                                onClose={() => setScannerOpen(false)}
                                onVerify={(token) =>
                                  act('handoff', {
                                    channel: 'qr',
                                    credential: token,
                                  })
                                }
                              />
                            )}
                          </>
                        ) : (
                          <p>Waiting for authoritative handoff availability.</p>
                        )}
                      </>
                    )}
                  </>
                )}
              {stage === 'delivery' && order.paymentStatus === 'paid' && (
                <>
                  {buyer ? (
                    <p>
                      Payment is secured. Waiting for the Seller to start
                      delivery. Inspect the item on arrival before presenting
                      your handoff credential.
                    </p>
                  ) : (
                    <>
                      <p>
                        Payment is secured. Start delivery when you begin the
                        delivery effort.
                      </p>
                      <StatefulButton
                        className={pageStyles.primaryAction}
                        disabled={blocked}
                        onClick={() => act('start-delivery')}
                      >
                        Start delivery
                      </StatefulButton>
                    </>
                  )}
                </>
              )}
              {stage === 'shipment' && order.paymentStatus === 'paid' && (
                <>
                  {data?.courier?.state === 'not_shipped' &&
                    (!buyer ? (
                      <CourierShipmentForm
                        disabled={blocked}
                        onShip={(carrierLabel, trackingReference) =>
                          act('shipment', { carrierLabel, trackingReference })
                        }
                      />
                    ) : (
                      <p>Waiting for the Seller to ship.</p>
                    ))}
                  {data?.courier?.state === 'shipped' && (
                    <>
                      {buyer ? (
                        <StatefulButton
                          className={pageStyles.primaryAction}
                          disabled={blocked}
                          onClick={() => act('received')}
                        >
                          Confirm Received
                        </StatefulButton>
                      ) : (
                        <p>
                          Waiting for trusted delivery or Buyer confirmation of
                          receipt.
                        </p>
                      )}
                    </>
                  )}
                  {data?.courier?.state === 'delivered' && (
                    <p>
                      Courier delivery recorded. Refreshing Protection state.
                    </p>
                  )}
                </>
              )}
              {stage === 'protection' && data && (
                <>
                  {buyer && !data.fulfillment.protectionHold && (
                    <>
                      <label
                        className={`${workspace.field} ${pageStyles.protectionIssue}`}
                      >
                        Describe the issue
                        <GlideSelect
                          ariaLabel="Protection issue reason"
                          overlay={true}
                          placement="top-desktop"
                          size="lg"
                          disabled={blocked}
                          value={reason}
                          options={[
                            {
                              value: 'ITEM_NOT_RECEIVED',
                              label: 'Item not received',
                            },
                            { value: 'WRONG_ITEM', label: 'Wrong item' },
                            {
                              value: 'MATERIALLY_NOT_AS_DESCRIBED',
                              label: 'Materially not as described',
                            },
                            {
                              value: 'MISSING_AGREED_ITEM',
                              label: 'Missing agreed item',
                            },
                            {
                              value: 'QUALIFYING_HIDDEN_DEFECT',
                              label: 'Qualifying hidden defect',
                            },
                          ]}
                          onChange={setReason}
                        />
                      </label>
                      <StatefulButton
                        className={pageStyles.reportIssue}
                        disabled={blocked || !reason.trim()}
                        onClick={() => act('case', { reason: reason.trim() })}
                      >
                        Report an issue
                      </StatefulButton>
                    </>
                  )}
                </>
              )}
            </section>
          )}
      </section>
      {(flow.error || error || blocked) && (
        <section className={profile.panel} aria-label="Order refresh">
          {(flow.error || error) && <p role="alert">{flow.error || error}</p>}
          {(flow.error || error || blocked) && (
            <CardAction
              disabled={busy.current}
              onClick={() =>
                refresh().catch(() =>
                  setError(
                    'Unable to refresh. Retry refreshing the Order to recover.'
                  )
                )
              }
            >
              Refresh Order
            </CardAction>
          )}
        </section>
      )}
    </>
  )
}
