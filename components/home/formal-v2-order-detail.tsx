import { CardAction } from '@/components/listings/card-actions'
import { ListingMedia } from '@/components/listings/listing-media'
import { offerAmount } from '@/lib/offer-amount'
import type { OrderWorkspace } from '@/lib/order-workspaces'
import { orderWorkspaceLabels } from '@/lib/order-workspaces'
import type { FormalOrder } from '@/types/order'

import { OfferTermsSummary } from './offer-ui'
import { OrderCampusPayment } from './order-campus-payment'
import { OrderCancellation } from './order-cancellation'
import styles from './order-detail-preview.module.css'
import { OrderMeetup } from './order-meetup'
import profile from './profile.module.css'

// V2 foundation, D1 scheduling and D2A On Campus payment; V1 and Delivery actions stay isolated.
export function FormalV2OrderDetail({
  order,
  role,
  mode,
  offset,
  onBack,
  onRefresh,
  onCancelled,
  onUpdated,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  mode: OrderWorkspace
  offset: number
  onBack: () => void
  onRefresh: () => Promise<void>
  onCancelled: (order: FormalOrder, serverTime: string) => void
  onUpdated?: (order: FormalOrder, serverTime: string) => void
}) {
  if (!order.v2)
    return <p role="alert">Order snapshot unavailable. Retry refresh.</p>
  const { listing } = order.snapshot
  const terms = order.v2.terms
  return (
    <section
      className={styles.detail}
      aria-label="Order Detail"
      data-formal-order={order.id}
      data-order-protocol="2"
      data-order-role={role}
    >
      <CardAction onClick={onBack}>{orderWorkspaceLabels[mode]}</CardAction>
      <h3 className={styles.snapshotTitle}>{listing.title}</h3>
      <p>
        {
          {
            cancelled: 'Order cancelled',
            completed: 'Order completed',
            expired: 'Order expired',
            open: 'Pending transaction',
          }[order.lifecycle]
        }
      </p>
      <section className={profile.panel} aria-label="Overview">
        <h4>Overview</h4>
        {listing.photoUrls.length > 0 && (
          <div className={styles.item}>
            <ListingMedia images={listing.photoUrls} alt={listing.title} />
          </div>
        )}
        <dl className={styles.amounts}>
          <dt>Condition</dt>
          <dd>{order.v2.condition}</dd>
          <dt>Category</dt>
          <dd>
            {listing.category} {'\u00b7'} {order.v2.subcategory}
          </dd>
          <dt>Public asking price at acceptance</dt>
          <dd>{offerAmount(order.v2.askingPriceCents)}</dd>
          <dt>Buyer</dt>
          <dd>{order.snapshot.buyer}</dd>
          <dt>Seller</dt>
          <dd>{order.snapshot.seller}</dd>
        </dl>
        <p>{order.v2.description}</p>
      </section>
      <section className={profile.panel} aria-label="Accepted offer terms">
        <h4>Accepted offer</h4>
        <OfferTermsSummary terms={terms} />
      </section>
      {terms.fulfillment === 'on_campus' && (
        <OrderMeetup
          order={order}
          role={role}
          offset={offset}
          onRefresh={onRefresh}
          onUpdated={onUpdated || (() => {})}
        />
      )}
      {terms.fulfillment === 'on_campus' ? (
        <OrderCampusPayment
          order={order}
          role={role}
          onRefresh={onRefresh}
          onUpdated={onUpdated || (() => {})}
        />
      ) : (
        <section className={profile.panel} aria-label="Payment">
          <h4>Payment pending</h4>
          <p>Payment is required before delivery.</p>
        </section>
      )}
      <OrderCancellation
        order={order}
        role={role}
        offset={offset}
        onRefresh={onRefresh}
        onCancelled={onCancelled}
      />
    </section>
  )
}
