import { ChevronLeft } from 'lucide-react'
import { useState } from 'react'

import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import { ListingMedia } from '@/components/listings/listing-media'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import { deriveOrderPresentation } from '@/lib/order-progress-ui'
import type { FormalOrderPresentation } from '@/lib/order-progress-ui'
import { formatSchedule } from '@/lib/order-schedule-preview'
import {
  terminalOrderOutcome,
  orderStatusLabel,
} from '@/lib/order-terminal-presentation'
import {
  formatOrderVisualAmount,
  fulfillmentLabels,
} from '@/lib/order-visual-preview'
import { orderWorkspaceLabels } from '@/lib/order-workspaces'
import type { OrderWorkspace } from '@/lib/order-workspaces'
import type { FormalOrder } from '@/types/order'

import { FormalOrderPayment } from './formal-order-payment'
import { FormalV2OrderDetail } from './formal-v2-order-detail'
import { OrderCancellation } from './order-cancellation'
import { OrderCountdown } from './order-countdown'
import styles from './order-detail-preview.module.css'
import { OrderProgress } from './order-progress'
import { OrderVisualTerms } from './order-request-preview'
import profile from './profile.module.css'

function Amounts({ order }: { order: FormalOrder }) {
  const rows: Array<[string, number | null]> = [
    ['Item price', order.itemAmount],
    ['Shipping', order.shippingAmount],
    ['Service fee', order.serviceFee],
    ['Total', order.totalAmount],
  ]
  return (
    <>
      <dl className={styles.amounts}>
        {rows
          .filter(([, amount]) => amount !== null)
          .map(([label, amount]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt>{label}</dt>
              <dd>{formatOrderVisualAmount(amount as number)}</dd>
            </div>
          ))}
      </dl>
      {order.moneyStatus === 'shipping_pending' && (
        <p>Shipping cost pending. No payable total has been finalized.</p>
      )}
    </>
  )
}

function FormalFulfillment({ order }: { order: FormalOrder }) {
  const { draft } = order.snapshot
  let shippingCost = 'To be arranged'
  if (order.shippingAmount !== null)
    shippingCost = formatOrderVisualAmount(order.shippingAmount)
  if (draft.shippingCost === 'included') shippingCost = 'Included'
  return (
    <>
      <h4>{fulfillmentLabels[draft.fulfillment]}</h4>
      <dl className={styles.amounts}>
        {draft.fulfillment === 'shipping' ? (
          <>
            <dt>Shipping method</dt>
            <dd>{draft.shippingMethod || 'To be arranged'}</dd>
            <dt>Shipping cost</dt>
            <dd>{shippingCost}</dd>
          </>
        ) : (
          <>
            <dt>
              {draft.fulfillment === 'meet'
                ? 'Meeting location'
                : 'Pickup location'}
            </dt>
            <dd>{draft.location}</dd>
            <dt>Schedule</dt>
            <dd>{formatSchedule(draft)}</dd>
          </>
        )}
      </dl>
      {draft.note && <p className={styles.note}>{draft.note}</p>}
    </>
  )
}

function FormalNextInformation({
  order,
  role,
  offset,
  presentation,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  offset: number
  presentation: FormalOrderPresentation
}) {
  return (
    <section
      className={`${profile.panel} ${styles.next}`}
      aria-label="Next Step"
    >
      <div>
        <p className={styles.eyebrow}>Next Step</p>
        <h4>{presentation.title}</h4>
        {presentation.showReservation && (
          <>
            <p className={styles.countdown}>
              {role === 'buyer' ? 'Reserved for you' : 'Buyer payment pending'}{' '}
              &middot;{' '}
              <OrderCountdown
                expiresAt={Date.parse(order.reservationExpiresAt!)}
                serverOffsetMs={offset}
                suffix="reservation remaining"
              />
            </p>
            <p className={profile.caption}>
              {role === 'buyer'
                ? 'Your listing is reserved while the payment window remains active.'
                : 'The listing is reserved for this buyer.'}
            </p>
          </>
        )}
        {presentation.showMeeting && (
          <dl className={styles.amounts}>
            <dt>Location</dt>
            <dd>{order.snapshot.draft.location}</dd>
            <dt>Schedule</dt>
            <dd>{formatSchedule(order.snapshot.draft)}</dd>
            {order.snapshot.draft.note && (
              <>
                <dt>Meeting details</dt>
                <dd>{order.snapshot.draft.note}</dd>
              </>
            )}
          </dl>
        )}
        <p className={profile.caption}>{presentation.description}</p>
      </div>
    </section>
  )
}

function TerminalOrderReport({ order }: { order: FormalOrder }) {
  const terminal = terminalOrderOutcome(order.lifecycle)
  const expired = order.lifecycle === 'expired'
  return (
    <section
      className={`${profile.panel} ${styles.terminalReport}`}
      aria-label="Transaction status"
    >
      <h4>{expired ? 'Order expired' : 'Order cancelled'}</h4>
      <p>No payment was completed.</p>
      <dl className={styles.amounts}>
        <dt>Request status</dt>
        <dd>Accepted</dd>
        {order.acceptedAt && (
          <>
            <dt>Accepted at</dt>
            <dd>
              <time dateTime={order.acceptedAt}>
                {new Date(order.acceptedAt).toLocaleString()}
              </time>
            </dd>
          </>
        )}
        <dt>Order outcome</dt>
        <dd>{terminal}</dd>
        {expired && (
          <>
            <dt>Reservation</dt>
            <dd>Reservation expired</dd>
          </>
        )}
        {expired && order.expiredAt && (
          <>
            <dt>Expired at</dt>
            <dd>
              <time dateTime={order.expiredAt}>
                {new Date(order.expiredAt).toLocaleString()}
              </time>
            </dd>
          </>
        )}
        <dt>Payment</dt>
        <dd>Not completed</dd>
        {order.cancellation && (
          <>
            <dt>Cancelled by</dt>
            <dd>
              {order.cancellation.byRole === 'buyer' ? 'Buyer' : 'Seller'}
            </dd>
            <dt>Reason</dt>
            <dd>{order.cancellation.reason}</dd>
            {order.cancellation.note && (
              <>
                <dt>Note</dt>
                <dd>{order.cancellation.note}</dd>
              </>
            )}
            <dt>Cancelled at</dt>
            <dd>
              <time dateTime={order.cancellation.at}>
                {new Date(order.cancellation.at).toLocaleString()}
              </time>
            </dd>
          </>
        )}
      </dl>
    </section>
  )
}

function LegacyFormalOrderDetail({
  order,
  userId,
  offset,
  mode,
  onBack,
  onRefresh,
  onCancelled,
}: {
  order: FormalOrder
  userId: string
  offset: number
  mode: OrderWorkspace
  onBack: () => void
  onRefresh: () => Promise<void>
  onCancelled: (order: FormalOrder, serverTime: string) => void
}) {
  const [tab, setTab] = useState(0)
  let role: 'buyer' | 'seller' | null = null
  if (userId === order.buyerId) role = 'buyer'
  else if (userId === order.sellerId) role = 'seller'
  if (!role) return <p role="alert">Order not accessible.</p>
  const presentation = deriveOrderPresentation(order, role)
  const expired = order.lifecycle === 'expired'
  const terminal = terminalOrderOutcome(order.lifecycle)
  const status = orderStatusLabel(order)
  const { listing, draft, buyer, seller } = order.snapshot
  return (
    <section
      className={styles.detail}
      aria-label="Order Detail"
      data-formal-order={order.id}
      data-order-role={role}
      data-order-terminal={terminal || undefined}
    >
      <button
        type="button"
        className={styles.back}
        aria-label={`Back to ${orderWorkspaceLabels[mode]}`}
        onClick={onBack}
      >
        <ChevronLeft size={16} aria-hidden="true" /> Back to{' '}
        {orderWorkspaceLabels[mode]}
      </button>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Order Detail</p>
          <h3>{listing.title}</h3>
        </div>
        <span className={terminal ? styles.historicalStatus : profile.verified}>
          {status}
        </span>
      </header>
      {terminal && <TerminalOrderReport order={order} />}
      {(!terminal || order.lifecycle === 'cancelled') && (
        <OrderCancellation
          order={order}
          role={role}
          offset={offset}
          showHistory={false}
          onRefresh={onRefresh}
          onCancelled={onCancelled}
        />
      )}
      {!terminal && (
        <FormalNextInformation
          order={order}
          role={role}
          offset={offset}
          presentation={presentation}
        />
      )}
      {!terminal && (
        <OrderProgress
          steps={presentation.steps}
          current={presentation.currentStep}
          terminal={presentation.terminal}
          completed={presentation.completedSteps}
        />
      )}
      <FluidTabs activeIndex={tab} onActiveIndexChange={setTab}>
        <FluidTabs.List aria-label="Order Detail tabs">
          {['Overview', 'Fulfillment', 'Payment'].map((label) => (
            <FluidTabs.Tab key={label}>
              <FluidTabs.Label>{label}</FluidTabs.Label>
            </FluidTabs.Tab>
          ))}
        </FluidTabs.List>
      </FluidTabs>
      <LocalTabContent tab={tab}>
        <section
          className={`${profile.panel} ${styles.tabPanel}`}
          aria-label={
            ['Order overview', 'Order fulfillment', 'Order payment'][tab]
          }
        >
          {tab === 0 && (
            <div className={styles.overview}>
              <div className={styles.item}>
                {listing.photoUrls.length ? (
                  <ListingMedia
                    images={listing.photoUrls}
                    alt={listing.title}
                  />
                ) : (
                  <span>No photo available</span>
                )}
              </div>
              <div>
                <h4>Request summary</h4>
                <OrderVisualTerms draft={draft} />
                <dl className={styles.identities}>
                  <dt>Buyer</dt>
                  <dd>{buyer}</dd>
                  <dt>Seller</dt>
                  <dd>{seller}</dd>
                </dl>
                {draft.note && <p className={styles.note}>{draft.note}</p>}
                <Amounts order={order} />
              </div>
            </div>
          )}
          {tab === 1 && <FormalFulfillment order={order} />}
          {tab === 2 && terminal && (
            <div>
              <h4>{expired ? 'Reservation expired' : 'Order cancelled'}</h4>
              <p>No payment was completed.</p>
              <Amounts order={order} />
            </div>
          )}
          {tab === 2 && !terminal && (
            <FormalOrderPayment
              order={order}
              userId={userId}
              offset={offset}
              onRefresh={onRefresh}
            />
          )}
        </section>
      </LocalTabContent>
    </section>
  )
}

export function FormalOrderDetail(
  props: Parameters<typeof LegacyFormalOrderDetail>[0] & {
    onUpdated?: (order: FormalOrder, serverTime: string) => void
  }
) {
  if (props.order.protocolVersion !== 2)
    return <LegacyFormalOrderDetail {...props} />
  const role = props.userId === props.order.buyerId ? 'buyer' : 'seller'
  if (
    props.userId !== props.order.buyerId &&
    props.userId !== props.order.sellerId
  )
    return <p role="alert">Order not accessible.</p>
  return <FormalV2OrderDetail {...props} role={role} />
}
