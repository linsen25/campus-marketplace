import { CardAction } from '@/components/listings/card-actions'
import { WorkspaceEmpty } from '@/components/listings/workspace-empty'
import {
  previewNextStep,
  previewStatusLabel,
} from '@/lib/order-interaction-preview'
import type { PreviewOrder } from '@/lib/order-interaction-preview'
import {
  fulfillmentLabels,
  formatOrderVisualAmount,
} from '@/lib/order-visual-preview'
import {
  deriveOrderWorkspaces,
  orderWorkspaceLabels,
  orderWorkspaceRole,
} from '@/lib/order-workspaces'
import type { OrderWorkspace } from '@/lib/order-workspaces'

import workspaceStyles from '../listings/listing-workspace.module.css'

import { FormalOrders } from './formal-orders'
import { OrderDetailPreview } from './order-detail-preview'
import styles from './order-detail-preview.module.css'
import { useOrderVisual } from './order-visual-context'
import profile from './profile.module.css'

/** Explicit buyer/seller workspace boundary; cards share presentation, never state stores. */
export function OrderList({
  mode,
  orders,
}: {
  mode: OrderWorkspace
  orders: readonly PreviewOrder[]
}) {
  const visuals = useOrderVisual()
  const role = orderWorkspaceRole(mode)
  return (
    <section
      aria-label={orderWorkspaceLabels[mode]}
      data-order-workspace={mode}
    >
      {orders.length ? (
        <div className={styles.orderList}>
          <p className={workspaceStyles.hint}>
            Ephemeral local previews in this browser only.
          </p>
          {orders.map((order) => (
            <article
              key={order.id}
              className={`${profile.panel} ${styles.orderCard}`}
              data-order-list-card={order.id}
            >
              <div>
                <h4>{order.snapshot.listing.title}</h4>
                <p>
                  {formatOrderVisualAmount(order.snapshot.draft.price)} &middot;{' '}
                  {fulfillmentLabels[order.snapshot.draft.fulfillment]}
                </p>
                <span className={profile.verified}>
                  {previewStatusLabel(order, role)}
                </span>
                <p className={workspaceStyles.hint}>
                  {previewNextStep(order, role)}
                </p>
              </div>
              <CardAction
                variant="blue"
                onClick={() => visuals.open(order.id, mode)}
              >
                View Order
              </CardAction>
            </article>
          ))}
        </div>
      ) : (
        <WorkspaceEmpty>
          {mode === 'purchases' ? 'No purchases yet.' : 'No sales yet.'}
        </WorkspaceEmpty>
      )}
    </section>
  )
}

export function Orders({
  destination,
}: {
  destination: string
  desktop?: boolean
  onNavigate?: (workspace: OrderWorkspace) => void
}) {
  const visuals = useOrderVisual()
  const mode: OrderWorkspace =
    destination === 'sales' || destination === 'selling' ? 'sales' : 'purchases'
  if (
    !visuals.enabled &&
    process.env.NEXT_PUBLIC_MESSAGES_ENV === 'staging' &&
    process.env.NEXT_PUBLIC_SUPABASE_URL ===
      'https://pcaqxezdfxofysghssyo.supabase.co'
  )
    return <FormalOrders key={mode} mode={mode} />
  const collections = deriveOrderWorkspaces(
    visuals.state.orders,
    visuals.viewerId
  )
  const order = collections[mode].find(
    (value) =>
      value.id === visuals.selection?.id && visuals.selection.workspace === mode
  )
  if (order)
    return (
      <OrderDetailPreview
        key={`${mode}-${order.id}`}
        order={order}
        orderRole={orderWorkspaceRole(mode)}
        originWorkspace={mode}
        onBack={() => visuals.showList()}
      />
    )
  return (
    <section className={workspaceStyles.workspace} aria-label="Orders">
      {mode === 'purchases' ? (
        <OrderList
          key="purchases"
          mode="purchases"
          orders={collections.purchases}
        />
      ) : (
        <OrderList key="sales" mode="sales" orders={collections.sales} />
      )}
    </section>
  )
}
