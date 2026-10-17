import { useRouter } from 'next/router'

import { CardAction } from '@/components/listings/card-actions'
import { WorkspaceEmpty } from '@/components/listings/workspace-empty'
import { useFormalOrders } from '@/hooks/use-formal-orders'
import {
  deriveOrderListBucket,
  filterOrderList,
  orderListOutcome,
} from '@/lib/order-list-presentation'
import type { OrderListBucket } from '@/lib/order-list-presentation'
import { orderStatusLabel } from '@/lib/order-terminal-presentation'
import {
  formatOrderVisualAmount,
  fulfillmentLabels,
} from '@/lib/order-visual-preview'
import type { OrderWorkspace } from '@/lib/order-workspaces'
import { orderWorkspaceLabels } from '@/lib/order-workspaces'
import type { FormalOrder } from '@/types/order'

import workspace from '../listings/listing-workspace.module.css'

import { FormalOrderDetail } from './formal-order-detail'
import { OrderCountdown } from './order-countdown'
import styles from './order-detail-preview.module.css'
import { OrderListingProvenance } from './order-listing-provenance'
import {
  OrderListSkeleton,
  OrderDetailSkeleton,
  OrderLoadError,
} from './order-loading'
import profile from './profile.module.css'

function orderFulfillmentLabel(order: FormalOrder) {
  if (order.protocolVersion !== 2)
    return fulfillmentLabels[order.snapshot.draft.fulfillment]
  return order.v2?.terms.fulfillment === 'on_campus' ? 'Meeting' : 'Delivery'
}
function OrderState({ order, offset }: { order: FormalOrder; offset: number }) {
  const outcome = orderListOutcome(order)
  const label =
    outcome === 'Completed' || outcome === 'Refunded'
      ? outcome
      : orderStatusLabel(order)
  return (
    <div>
      <span
        className={
          orderListOutcome(order) ? styles.historicalStatus : profile.verified
        }
      >
        {label}
      </span>
      {!outcome &&
        order.paymentStatus !== 'paid' &&
        order.reservationExpiresAt && (
          <p>
            <OrderCountdown
              expiresAt={Date.parse(order.reservationExpiresAt)}
              serverOffsetMs={offset}
              suffix="reservation remaining"
            />
          </p>
        )}
      {!outcome && (
        <p className={workspace.hint}>
          {order.v2?.terms.paymentMode === 'external'
            ? 'Paid outside UU \u00b7 No UU payment protection'
            : 'Payment integration is not enabled yet.'}
        </p>
      )}
    </div>
  )
}
export function FormalOrders({ mode }: { mode: OrderWorkspace }) {
  const query = useFormalOrders(mode)
  const router = useRouter()
  const selected =
    typeof router.query.order === 'string' &&
    router.query.section === 'orders' &&
    router.query.destination === mode
      ? router.query.order
      : null
  const orders = query.data?.orders || []
  const order = orders.find((value) => value.id === selected)
  let bucket: OrderListBucket = order ? deriveOrderListBucket(order) : 'active'
  if (
    router.query.orderView === 'history' ||
    router.query.orderView === 'active'
  )
    bucket = router.query.orderView
  const visibleOrders = filterOrderList(orders, bucket)
  const navigate = (id?: string, nextBucket = bucket) => {
    const navigationQuery = { ...router.query }
    delete navigationQuery.order
    router
      .push(
        {
          pathname: router.pathname,
          query: {
            ...navigationQuery,
            section: 'orders',
            destination: mode,
            orderView: nextBucket,
            ...(id ? { order: id } : {}),
          },
        },
        undefined,
        { shallow: true }
      )
      .catch(() => {})
  }
  if (query.loading)
    return selected ? <OrderDetailSkeleton /> : <OrderListSkeleton />
  if (query.error && !query.data)
    return (
      <OrderLoadError message={query.error} onRetry={() => query.refresh()} />
    )
  if (!query.userId)
    return <WorkspaceEmpty>Sign in to view your {mode}.</WorkspaceEmpty>
  if (order && query.userId)
    return (
      <>
        <FormalOrderDetail
          key={order.id}
          order={order}
          userId={query.userId}
          offset={query.offset}
          mode={mode}
          onBack={() => navigate()}
          onRefresh={() => query.refreshOrder(order.id)}
          onUpdated={(value, serverTime) => query.applyOrder(value, serverTime)}
          onCancelled={(value, serverTime) => {
            query.applyOrder(value, serverTime)
            navigate(undefined, 'history')
          }}
        />
        {query.error && <p role="alert">{query.error}</p>}
      </>
    )
  if (selected)
    return (
      <div role="alert">
        <p>Order not found or not accessible in this workspace.</p>
        <CardAction onClick={() => navigate()}>
          {orderWorkspaceLabels[mode]}
        </CardAction>
      </div>
    )
  return (
    <section className={workspace.workspace} aria-label="Orders">
      <div
        className={`${profile.segment} ${styles.listFilter}`}
        role="group"
        aria-label="Order list view"
      >
        {(['active', 'history'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={bucket === value}
            onClick={() => navigate(undefined, value)}
          >
            {value === 'active' ? 'Active' : 'History'}
          </button>
        ))}
      </div>
      {query.error && (
        <div role="alert">
          <p>{query.error}</p>
          <CardAction variant="green" onClick={() => query.refresh()}>
            Retry Orders
          </CardAction>
        </div>
      )}
      <section
        aria-label={orderWorkspaceLabels[mode]}
        data-order-workspace={mode}
      >
        {visibleOrders.length ? (
          <div className={styles.orderList}>
            {visibleOrders.map((value) => (
              <article
                key={value.id}
                className={`${profile.panel} ${styles.orderCard} ${
                  orderListOutcome(value) ? styles.historicalCard : ''
                }`}
                data-order-terminal={orderListOutcome(value) || undefined}
                data-order-list-card={value.id}
              >
                <div>
                  <h4>{value.snapshot.listing.title}</h4>
                  <OrderListingProvenance
                    provenance={value.listingProvenance}
                  />
                  <p>
                    {formatOrderVisualAmount(value.itemAmount)} &middot;{' '}
                    {orderFulfillmentLabel(value)}
                  </p>
                  <OrderState order={value} offset={query.offset} />
                </div>
                {orderListOutcome(value) ? (
                  <button
                    type="button"
                    className={styles.historyAction}
                    onClick={() => navigate(value.id)}
                  >
                    View details
                  </button>
                ) : (
                  <CardAction
                    variant="green"
                    onClick={() => navigate(value.id)}
                  >
                    View Order
                  </CardAction>
                )}
              </article>
            ))}
          </div>
        ) : (
          <WorkspaceEmpty>
            {bucket === 'active' ? 'No active orders' : 'No order history yet.'}
          </WorkspaceEmpty>
        )}
      </section>
    </section>
  )
}
