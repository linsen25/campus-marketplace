import { useEffect, useState } from 'react'

import ShiningButton from '@/components/animata/button/shining-button'
import FluidTabs from '@/components/animata/tabs/fluid-tabs'
import { CardAction } from '@/components/listings/card-actions'
import { ListingMedia } from '@/components/listings/listing-media'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { LocalTabContent } from '@/components/ui/local-tab-content'
import {
  canCancelPreviewOrder,
  previewNextStep,
  previewOrderStatus,
  previewProgress,
  previewStatusLabel,
} from '@/lib/order-interaction-preview'
import type { PreviewOrder, PreviewRole } from '@/lib/order-interaction-preview'
import { getOrderPreviewPresentation } from '@/lib/order-presentation-preview'
import { formatSchedule } from '@/lib/order-schedule-preview'
import {
  calculateOrderRequestVisualAmounts,
  previewShippingLabel,
  formatOrderVisualAmount,
  fulfillmentLabels,
} from '@/lib/order-visual-preview'
import { orderWorkspaceLabels } from '@/lib/order-workspaces'
import type { OrderWorkspace } from '@/lib/order-workspaces'

import workspace from '../listings/listing-workspace.module.css'

import { OrderCountdown } from './order-countdown'
import styles from './order-detail-preview.module.css'
import { OrderPreviewControls } from './order-preview-controls'
import {
  PreviewAddressForm,
  PreviewCodeForm,
  PreviewReasonDialog,
  PreviewCancellationDialog,
  PreviewShipmentForm,
} from './order-preview-forms'
import { OrderProgress } from './order-progress'
import { OrderVisualTerms } from './order-request-preview'
import { useOrderVisual } from './order-visual-context'
import profile from './profile.module.css'

type Confirmation = 'cancel' | 'inspect' | 'issue' | 'receive' | null
function NextActions({
  order,
  role,
  onDialog,
  onTab,
}: {
  order: PreviewOrder
  role: PreviewRole
  onDialog: (value: Confirmation) => void
  onTab: (value: number) => void
}) {
  const shipping = order.snapshot.draft.fulfillment === 'shipping'
  let paymentLabel = 'Continue to Payment'
  if (previewNextStep(order, role) === 'Shipping cost pending')
    paymentLabel = 'Shipping cost pending'
  if (role === 'buyer' && order.status === 'reserved')
    return (
      <div className={styles.nextActions}>
        <ShiningButton
          variant="blue"
          desktopAppearance={true}
          onClick={() => onTab(shipping && !order.address ? 1 : 2)}
        >
          {shipping && !order.address ? 'Add shipping address' : paymentLabel}
        </ShiningButton>
      </div>
    )
  if (
    order.status === 'paid' &&
    !shipping &&
    role === 'buyer' &&
    !order.handoffCode
  )
    return (
      <CardAction variant="blue" onClick={() => onDialog('inspect')}>
        Confirm item is acceptable
      </CardAction>
    )
  if (order.status === 'paid' && role === 'seller' && shipping)
    return (
      <CardAction variant="blue" onClick={() => onTab(1)}>
        {shipping ? 'Add shipment details' : 'Enter Handoff Code'}
      </CardAction>
    )
  if (order.status === 'delivered' && role === 'buyer')
    return (
      <CardAction variant="blue" onClick={() => onDialog('receive')}>
        Confirm received
      </CardAction>
    )
  return null
}

function ShippingFulfillment({
  order,
  role,
  onPayment,
}: {
  order: PreviewOrder
  role: PreviewRole
  onPayment: () => void
}) {
  const visuals = useOrderVisual()
  const reserved = order.status === 'reserved'
  const paid = [
    'paid',
    'shipped',
    'delivered',
    'protection',
    'completed',
  ].includes(order.status)
  return (
    <>
      <dl className={styles.amounts}>
        <dt>Shipping method</dt>
        <dd>{order.snapshot.draft.shippingMethod || 'To be arranged'}</dd>
        <dt>Shipping cost</dt>
        <dd>{previewShippingLabel(order.snapshot.draft)}</dd>
      </dl>
      {role === 'buyer' && reserved ? (
        <PreviewAddressForm
          initial={order.address}
          onSave={(address) => {
            visuals.update(order.id, { type: 'address', address }, role)
            onPayment()
          }}
        />
      ) : (
        <div className={styles.placeholder} aria-label="Shipping address">
          <h5>Shipping address</h5>
          {paid && order.address ? (
            <address>
              {order.address.recipient}
              <br />
              {order.address.address}
              {order.address.unit && ` · ${order.address.unit}`}
              <br />
              {order.address.city}, {order.address.province}{' '}
              {order.address.postal}
              <p className={profile.caption}>Synthetic local preview address</p>
            </address>
          ) : (
            <p>Available after buyer payment</p>
          )}
        </div>
      )}
      {role === 'seller' && order.status === 'paid' && (
        <PreviewShipmentForm
          onSave={(carrier, tracking) =>
            visuals.update(order.id, { type: 'ship', carrier, tracking }, role)
          }
        />
      )}
      {order.carrier && (
        <dl className={styles.amounts}>
          <dt>Carrier</dt>
          <dd>{order.carrier}</dd>
          <dt>Tracking number</dt>
          <dd>{order.tracking}</dd>
        </dl>
      )}
    </>
  )
}
function HandoffFulfillment({
  order,
  role,
}: {
  order: PreviewOrder
  role: PreviewRole
}) {
  const visuals = useOrderVisual()
  const meet = order.snapshot.draft.fulfillment === 'meet'
  return (
    <>
      <dl className={styles.amounts}>
        <dt>{meet ? 'Meeting location' : 'Pickup location'}</dt>
        <dd>{order.snapshot.draft.location}</dd>
        <dt>Schedule</dt>
        <dd>{formatSchedule(order.snapshot.draft)}</dd>
        <dt>Handoff status</dt>
        <dd>{previewOrderStatus[order.status]}</dd>
      </dl>
      {role === 'buyer' && order.status === 'paid' && order.handoffCode && (
        <div className={styles.codePanel}>
          <h5>Handoff Code</h5>
          <output data-handoff-code="true" className={styles.code}>
            {order.handoffCode}
          </output>
          <p className={workspace.hint}>
            Local preview code only · Share at handoff after inspecting the
            item.
          </p>
          <div className={styles.qrPlaceholder}>QR preview placeholder</div>
        </div>
      )}
      {role === 'seller' && order.status === 'paid' && (
        <PreviewCodeForm
          code={order.handoffCode}
          onConfirm={(code) =>
            visuals.update(order.id, { type: 'verify-code', code }, role)
          }
        />
      )}
    </>
  )
}
function PaymentPreview({
  order,
  role,
}: {
  order: PreviewOrder
  role: PreviewRole
}) {
  const shipping = order.snapshot.draft.fulfillment === 'shipping'
  const amounts = calculateOrderRequestVisualAmounts(order.snapshot.draft)
  const visuals = useOrderVisual()
  if (!amounts)
    return (
      <div className={styles.payment}>
        <div>
          <h4>Order Summary</h4>
          <dl className={styles.amounts}>
            <dt>Item amount</dt>
            <dd>{formatOrderVisualAmount(order.snapshot.draft.price)}</dd>
            <dt>Shipping</dt>
            <dd>To be arranged</dd>
            <dt>Payment preview state</dt>
            <dd>Shipping cost pending</dd>
          </dl>
        </div>
        <div className={styles.placeholder}>
          <h5>Shipping cost pending</h5>
          <p>The final shipping cost must be agreed before payment.</p>
        </div>
      </div>
    )
  return (
    <div className={styles.payment}>
      <div>
        <h4>Order Summary</h4>
        <dl className={styles.amounts}>
          <dt>Item amount</dt>
          <dd>{formatOrderVisualAmount(amounts.item)}</dd>
          {shipping && (
            <>
              <dt>Shipping</dt>
              <dd>{previewShippingLabel(order.snapshot.draft)}</dd>
            </>
          )}
          <dt>Marketplace service fee</dt>
          <dd>{formatOrderVisualAmount(amounts.serviceFee)}</dd>
          <dt className={styles.total}>Total</dt>
          <dd className={styles.total}>
            {formatOrderVisualAmount(amounts.total)}
          </dd>
          <dt>Seller platform fee</dt>
          <dd>{formatOrderVisualAmount(amounts.sellerFee)}</dd>
          <dt>Payment preview state</dt>
          <dd>
            {order.status === 'reserved'
              ? 'Payment pending'
              : previewOrderStatus[order.status]}
          </dd>
          <dt>Seller payout status · Preview</dt>
          <dd>{order.issue ? 'On hold' : 'Pending'}</dd>
        </dl>
        <p className={profile.caption}>
          Preview rule: 4% of item + shipping, minimum CA$1, maximum CA$15. No
          real pricing or payout behavior.
        </p>
      </div>
      <div className={styles.placeholder}>
        <h5>Payment method</h5>
        <p>Embedded payment component will appear here.</p>
        <p className={profile.caption}>
          Product-design copy · Preview only: Pay only inside an Order to remain
          covered. External payments are not covered by Marketplace Protection.
        </p>
        <p className={profile.caption}>
          Be cautious of external payment links. No money or payment details are
          collected here.
        </p>
        {visuals.enabled && role === 'buyer' && order.status === 'reserved' && (
          <div
            className={styles.previewControls}
            aria-label="Local Preview Controls"
          >
            <h5>DEV / PREVIEW Controls</h5>
            <p>Local simulation · No payment provider</p>
            <button
              type="button"
              disabled={shipping && !order.address}
              onClick={() => visuals.update(order.id, { type: 'pay' }, role)}
            >
              Simulate payment success
            </button>
            {shipping && !order.address && (
              <p>Add a preview shipping address first.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function NextInformation({
  order,
  role,
}: {
  order: PreviewOrder
  role: PreviewRole
}) {
  const presentation = getOrderPreviewPresentation(order, role)
  const amounts = calculateOrderRequestVisualAmounts(order.snapshot.draft)
  return (
    <div>
      <p className={styles.eyebrow}>Next Step</p>
      <h4>{presentation.title}</h4>
      <p className={profile.caption}>{presentation.description}</p>
      {order.status === 'reserved' && (
        <p className={styles.countdown}>
          {presentation.countdownLabel} &middot;{' '}
          <OrderCountdown expiresAt={order.expiresAt} />
        </p>
      )}
      {order.status === 'reserved' && role === 'buyer' && (
        <p>
          {amounts
            ? `Total: ${formatOrderVisualAmount(amounts.total)}`
            : 'Shipping cost pending'}
        </p>
      )}
      {order.status === 'protection' && order.protectionEndsAt && (
        <p className={styles.countdown}>
          <OrderCountdown
            expiresAt={order.protectionEndsAt}
            protection={true}
            suffix={presentation.protectionSuffix}
          />
        </p>
      )}
      <p className={profile.caption}>
        Local preview only &middot; No real payment, protection or payout.
      </p>
    </div>
  )
}

function PreviewEvents({
  order,
  role,
}: {
  order: PreviewOrder
  role: PreviewRole
}) {
  const visuals = useOrderVisual()
  return (
    <>
      {visuals.enabled && ['shipped', 'protection'].includes(order.status) && (
        <div
          className={styles.previewControls}
          aria-label="Local Preview Controls"
        >
          <h5>DEV / PREVIEW Controls · Local only</h5>
          {order.status === 'shipped' && (
            <button
              type="button"
              onClick={() =>
                visuals.update(order.id, { type: 'deliver' }, role)
              }
            >
              Simulate package delivered
            </button>
          )}
          {order.status === 'protection' && (
            <button
              type="button"
              disabled={Boolean(order.issue)}
              onClick={() =>
                visuals.update(order.id, { type: 'advance-protection' }, role)
              }
            >
              Advance protection window
            </button>
          )}
          <p>No carrier events, protection or payout is implemented.</p>
        </div>
      )}
    </>
  )
}

// eslint-disable-next-line complexity -- Shared detail keeps existing tabs, role actions and cancellation/issue confirmation guards together.
export function OrderDetailPreview({
  order,
  orderRole,
  originWorkspace,
  onBack,
}: {
  order: PreviewOrder
  orderRole: PreviewRole
  originWorkspace: OrderWorkspace
  onBack: () => void
}) {
  const { listing, draft, buyer, seller } = order.snapshot
  const visuals = useOrderVisual()
  const shipping = draft.fulfillment === 'shipping'
  const [debugRole, setDebugRole] = useState<PreviewRole | null>(null)
  const role = visuals.enabled && debugRole ? debugRole : orderRole
  const [tab, setTab] = useState(0)
  const [dialog, setDialog] = useState<Confirmation>(null)
  useEffect(() => setDialog(null), [role])
  useEffect(() => {
    if (order.status !== 'reserved') return undefined
    const timer = setTimeout(
      () => visuals.update(order.id, { type: 'expire' }, role),
      Math.max(0, order.expiresAt - Date.now())
    )
    return () => clearTimeout(timer)
  }, [order.expiresAt, order.id, order.status, role, visuals])
  const reportAvailable = [
    'paid',
    'shipped',
    'delivered',
    'protection',
  ].includes(order.status)
  return (
    <section
      className={styles.detail}
      aria-label="Order Detail preview"
      data-preview-order={order.id}
      data-order-status={order.status}
      data-origin-workspace={originWorkspace}
      data-order-role={orderRole}
      data-preview-role={role}
    >
      <button
        type="button"
        className={styles.back}
        aria-label={`Back to ${orderWorkspaceLabels[originWorkspace]}`}
        onClick={onBack}
      >
        <span aria-hidden="true">&larr;</span> Back to{' '}
        {orderWorkspaceLabels[originWorkspace]}
      </button>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Order Detail</p>
          <h3>{listing.title}</h3>
        </div>
        <span className={profile.verified}>
          {previewStatusLabel(order, role)}
        </span>
      </header>
      <section
        className={`${profile.panel} ${styles.next}`}
        aria-label="Next Step"
      >
        <NextInformation order={order} role={role} />
        <NextActions
          order={order}
          role={role}
          onDialog={setDialog}
          onTab={setTab}
        />
      </section>
      {canCancelPreviewOrder(order, Date.now()) && (
        <button
          type="button"
          className={styles.secondary}
          onClick={() => setDialog('cancel')}
        >
          Cancel Order
        </button>
      )}
      {order.cancellation && (
        <section className={profile.panel} aria-label="Cancellation details">
          <p>Cancelled by {order.cancellation.cancelledBy}</p>
          <p>Reason: {order.cancellation.cancelReason}</p>
          {order.cancellation.cancelNote && (
            <p>{order.cancellation.cancelNote}</p>
          )}
          <time dateTime={order.cancellation.cancelledAt}>
            {new Date(order.cancellation.cancelledAt).toLocaleString()}
          </time>
        </section>
      )}
      {reportAvailable && (
        <button
          type="button"
          className={styles.secondary}
          onClick={() => setDialog('issue')}
        >
          Report an issue
        </button>
      )}
      <OrderProgress shipping={shipping} current={previewProgress(order)} />
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
                <p className={profile.caption}>
                  Status: {previewOrderStatus[order.status]}
                </p>
                <OrderVisualTerms draft={draft} />
                <dl className={styles.identities}>
                  <dt>Buyer</dt>
                  <dd>{buyer}</dd>
                  <dt>Seller</dt>
                  <dd>{seller}</dd>
                </dl>
                {draft.note && <p className={styles.note}>{draft.note}</p>}
              </div>
            </div>
          )}
          {tab === 1 && (
            <>
              <h4>{fulfillmentLabels[draft.fulfillment]}</h4>
              {shipping ? (
                <ShippingFulfillment
                  order={order}
                  role={role}
                  onPayment={() => setTab(2)}
                />
              ) : (
                <HandoffFulfillment order={order} role={role} />
              )}
              <p className={profile.caption}>Never share verification codes.</p>
            </>
          )}
          {tab === 2 && <PaymentPreview order={order} role={role} />}
        </section>
      </LocalTabContent>
      <section
        className={styles.previewControls}
        aria-label="DEV / PREVIEW Controls - Local only"
      >
        <h5>DEV / PREVIEW Controls &middot; Local only</h5>
        <OrderPreviewControls role={role} onChange={setDebugRole} />
        <p className={profile.caption}>
          {orderWorkspaceLabels[originWorkspace]} workspace
          {debugRole ? ` - Local simulation as ${debugRole}` : ''}
        </p>
      </section>
      <PreviewEvents order={order} role={role} />
      {dialog === 'cancel' && (
        <PreviewCancellationDialog
          kind="order"
          role={role}
          onClose={() => setDialog(null)}
          onConfirm={(reason, note) => {
            visuals.update(order.id, { type: 'cancel', reason, note }, role)
            setDialog(null)
          }}
        />
      )}
      {dialog === 'issue' && (
        <PreviewReasonDialog
          role={role}
          onClose={() => setDialog(null)}
          onConfirm={(reason, detail) => {
            visuals.update(order.id, { type: 'issue', reason, detail }, role)
            setDialog(null)
          }}
        />
      )}
      {(dialog === 'inspect' || dialog === 'receive') && (
        <FadingDialog
          className={`${workspace.confirmation} ${styles.dialog}`}
          aria-label={
            dialog === 'inspect'
              ? 'Confirm item is acceptable?'
              : 'Confirm you received the item?'
          }
          onRequestClose={() => setDialog(null)}
        >
          <h3>
            {dialog === 'inspect'
              ? 'Confirm item is acceptable?'
              : 'Confirm you received the item?'}
          </h3>
          <p>
            {dialog === 'inspect'
              ? 'Inspect the item before confirming handoff.'
              : 'Only confirm after you have received and inspected the item.'}
          </p>
          <p className={workspace.hint}>
            Local preview only · No transaction is completed yet.
          </p>
          <ActionRow>
            <CardAction
              className={workspace.neutralButton}
              surfaceClassName={workspace.neutralSurface}
              onClick={() => setDialog(null)}
            >
              Go Back
            </CardAction>
            <CardAction
              variant="blue"
              onClick={() => {
                if (dialog === 'inspect')
                  visuals.update(
                    order.id,
                    {
                      type: 'reveal-code',
                      code: String(
                        100000 +
                          (crypto.getRandomValues(new Uint32Array(1))[0] %
                            900000)
                      ),
                    },
                    role
                  )
                else visuals.update(order.id, { type: 'receive' }, role)
                setDialog(null)
                setTab(1)
              }}
            >
              {dialog === 'inspect'
                ? 'Reveal Handoff Code'
                : 'Confirm Received'}
            </CardAction>
          </ActionRow>
        </FadingDialog>
      )}
    </section>
  )
}
