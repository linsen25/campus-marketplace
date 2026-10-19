import { ChevronLeft } from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { useEffect, useState } from 'react'

import { ListingMedia } from '@/components/listings/listing-media'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { useOrderFlow } from '@/hooks/use-order-flow'
import { listingLayoutTransition } from '@/lib/listing-layout-motion'
import { offerAmount } from '@/lib/offer-amount'
import { currentOrderProgress } from '@/lib/order-current-step'
import { orderPageAction, orderPresentation } from '@/lib/order-presentation'
import type { OrderWorkspace } from '@/lib/order-workspaces'
import { orderWorkspaceLabels } from '@/lib/order-workspaces'
import type { FormalOrder } from '@/types/order'

import { OrderCurrentStep } from './order-current-step'
import styles from './order-detail-preview.module.css'
import { OrderFlowCancellation } from './order-flow-cancellation'
import { OrderListingProvenance } from './order-listing-provenance'
import { OrderProgress } from './order-progress'
import { OrderStageDetails } from './order-stage-details'
import pageStyles from './order-stage-page.module.css'
import profile from './profile.module.css'

function OrderPageNavigation({
  mobile,
  showMobileBack,
  index,
  maximum,
  disabled,
  onNavigate,
}: {
  mobile: boolean
  showMobileBack: boolean
  index: number
  maximum: number
  disabled: boolean
  onNavigate: (index: number) => void
}) {
  return (
    <nav className={pageStyles.navigation} aria-label="Order page navigation">
      {(!mobile || showMobileBack) &&
        (index > 0 ? (
          <DynamicAction
            variant="dark-blue"
            className={pageStyles.backAction}
            direction="back"
            onClick={() => onNavigate(index - 1)}
          >
            Back
          </DynamicAction>
        ) : (
          <span />
        ))}
      {index < 5 && (
        <DynamicAction
          variant="dark-blue"
          className={pageStyles.nextAction}
          disabled={disabled || index >= maximum}
          onClick={() => onNavigate(Math.min(index + 1, maximum))}
        >
          Next
        </DynamicAction>
      )}
    </nav>
  )
}

// eslint-disable-next-line complexity -- Existing authoritative stage/role branches plus the Agreement readiness label.
function V2OrderPresentation({
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
  const [mobile, setMobile] = useState(false)
  const reducedMotion = useReducedMotion()
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1023px)')
    const update = () => setMobile(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  const flow = useOrderFlow(order, role)
  const progress = currentOrderProgress(order, flow.data)
  const presentation = orderPresentation(order, flow.data)
  const signature = JSON.stringify([
    order.id,
    order.lifecycle,
    order.paymentStatus,
    flow.data?.fulfillment.deliveryStartedAt,
    flow.data?.fulfillment.protectionStartedAt,
    flow.data?.fulfillment.cancellation?.state,
    flow.data?.fulfillment.agreement?.complete,
    flow.data?.courier?.state,
    flow.data?.fulfillment.externalExchange?.status,
  ])
  const [selection, setSelection] = useState<{
    signature: string
    index: number
  }>()
  const index =
    selection?.signature === signature
      ? Math.min(selection.index, presentation.maximum)
      : presentation.current
  const page = presentation.pages[index]
  const stage = orderPageAction(order, flow.data, page)
  const displayedStage =
    !flow.data && order.lifecycle === 'open' ? 'loading' : stage
  const readOnly = index < presentation.current || order.lifecycle !== 'open'
  const status = {
    open: flow.data?.fulfillment.agreement?.complete
      ? 'Agreement reached'
      : 'Agreement pending',
    cancelled: 'Order cancelled',
    expired: 'Order expired',
    completed: 'Completed',
  }[order.lifecycle]
  const terms = order.v2!.terms
  const confirmed = [...(order.meetup?.revisions || [])]
    .reverse()
    .find((r) => r.status === 'confirmed')
  const currentTerms =
    terms.fulfillment === 'on_campus' && confirmed
      ? {
          ...terms,
          meetupLocation: confirmed.location,
          scheduledAt: confirmed.scheduledAt,
        }
      : terms
  let fulfillmentLabel = 'Delivery'
  if (terms.fulfillment === 'on_campus') fulfillmentLabel = 'Meeting'
  else if (terms.deliveryMethod === 'courier') fulfillmentLabel = 'Shipping'
  let stageTitle: string | undefined
  if (page === 'fulfillment' && terms.fulfillment === 'on_campus')
    stageTitle = 'Meet / Inspect'
  if (
    page === 'handoff' &&
    (terms.fulfillment === 'on_campus' || terms.deliveryMethod !== 'courier')
  )
    stageTitle = 'Handoff'
  return (
    <section
      className={`${styles.detail} ${pageStyles.detail} ${
        order.lifecycle !== 'open' ? styles.history : ''
      }`}
      aria-label="Order Detail"
      data-formal-order={order.id}
      data-order-protocol="2"
      data-order-role={role}
      data-order-page={page}
    >
      <button
        type="button"
        className={styles.back}
        aria-label={`Back to ${orderWorkspaceLabels[mode]}`}
        onClick={onBack}
      >
        <ChevronLeft size={16} aria-hidden={true} />
        Back to {orderWorkspaceLabels[mode]}
      </button>
      <header className={pageStyles.header}>
        <div className={pageStyles.summary}>
          <div className={pageStyles.thumbnail}>
            {order.snapshot.listing.photoUrls.length ? (
              <ListingMedia
                images={order.snapshot.listing.photoUrls.slice(0, 1)}
                alt={order.snapshot.listing.title}
              />
            ) : (
              <span>No photo available</span>
            )}
          </div>
          <div className={pageStyles.summaryText}>
            <h4>{order.snapshot.listing.title}</h4>
            <p>
              {offerAmount(terms.itemAmountCents)} &middot; {fulfillmentLabel}
            </p>
            <OrderListingProvenance provenance={order.listingProvenance} />
          </div>
          <span
            className={
              order.lifecycle === 'open'
                ? profile.verified
                : styles.historicalStatus
            }
          >
            {status}
          </span>
        </div>
      </header>
      {terms.paymentMode === 'external' && (
        <p>Paid outside UU · No UU payment protection</p>
      )}
      <OrderProgress
        {...progress}
        terminalLabel={status}
        dates={progress.steps.map((label) => {
          const data = flow.data
          if (label === 'Agreement') {
            const agreement = data?.fulfillment.agreement
            return agreement?.complete &&
              agreement.buyerConfirmedAt &&
              agreement.sellerConfirmedAt
              ? [agreement.buyerConfirmedAt, agreement.sellerConfirmedAt]
                  .sort((a, b) => Date.parse(a) - Date.parse(b))
                  .at(-1)
              : null
          }
          if (label === 'Payment') return order.paymentPaidAt
          if (label === 'Shipped') return data?.courier?.shippedAt
          if (label === 'Delivered / Received')
            return data?.courier?.deliveredAt
          if (label === 'Handoff') return data?.fulfillment.handoffConfirmedAt
          if (label === 'Protection' || label === 'Completed')
            return data?.fulfillment.protectionCompletedAt
          if (label === 'Confirm exchange') {
            const exchange = data?.fulfillment.externalExchange
            return exchange?.status === 'confirmed' &&
              exchange.buyerConfirmedAt &&
              exchange.sellerConfirmedAt
              ? [exchange.buyerConfirmedAt, exchange.sellerConfirmedAt]
                  .sort((a, b) => Date.parse(a) - Date.parse(b))
                  .at(-1)
              : null
          }
          return null
        })}
      />
      <motion.div
        className={pageStyles.stageContent}
        layout={true}
        layoutDependency={page}
        transition={listingLayoutTransition(reducedMotion)}
      >
        <OrderStageDetails
          order={order}
          role={role}
          terms={page === 'review' ? terms : currentTerms}
          flow={flow}
          page={page}
          offset={offset}
          status={status}
        />
        <OrderCurrentStep
          order={order}
          role={role}
          flow={flow}
          stage={displayedStage}
          readOnly={readOnly}
          stageTitle={stageTitle}
          onRefresh={onRefresh}
          onUpdated={onUpdated || (() => {})}
        />
        {!['protection', 'completed'].includes(page) && (
          <OrderFlowCancellation
            order={order}
            role={role}
            flow={flow}
            onUpdated={onUpdated || (() => {})}
            onRefresh={onRefresh}
            onCancelled={onCancelled}
          />
        )}
      </motion.div>
      {order.lifecycle === 'open' && (
        <OrderPageNavigation
          mobile={mobile}
          showMobileBack={
            page === 'fulfillment' && terms.fulfillment === 'on_campus'
          }
          index={index}
          maximum={presentation.maximum}
          disabled={!flow.data || !order.economics}
          onNavigate={(target) => setSelection({ signature, index: target })}
        />
      )}
    </section>
  )
}
export function FormalV2OrderDetail(
  props: Parameters<typeof V2OrderPresentation>[0]
) {
  if (!props.order.v2)
    return <p role="alert">Order snapshot unavailable. Retry refresh.</p>
  return (
    <V2OrderPresentation key={`${props.order.id}:${props.role}`} {...props} />
  )
}
