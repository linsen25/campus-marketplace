import { CalendarDays, Check, Copy, MapPin, Tag } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { ListingMedia } from '@/components/listings/listing-media'
import { ExpandedCardPreview } from '@/components/velora/expandable-card'
import type { useOrderFlow } from '@/hooks/use-order-flow'
import { offerAmount } from '@/lib/offer-amount'
import { orderNumber } from '@/lib/order-presentation'
import type { OrderPage } from '@/lib/order-presentation'
import type { OfferTerms } from '@/types/offer'
import type { FormalOrder } from '@/types/order'

import listingWorkspace from '../listings/listing-workspace.module.css'

import { OrderCountdown } from './order-countdown'
import { PrivateAddress } from './order-current-step'
import styles from './order-detail-preview.module.css'
import pageStyles from './order-stage-page.module.css'
import profile from './profile.module.css'

function ConfirmedFulfillment({ terms }: { terms: OfferTerms }) {
  const mode = terms.fulfillment === 'on_campus' ? 'Meeting' : 'Delivery'
  return (
    <dl className={styles.amounts}>
      <dt>Payment method</dt>
      <dd>
        {terms.paymentMode === 'external' ? 'Pay independently' : 'Pay by UU'}
      </dd>
      <dt>Fulfillment</dt>
      <dd>{mode}</dd>
      {terms.fulfillment === 'delivery' && (
        <>
          <dt>Delivery subtype</dt>
          <dd>
            {terms.deliveryMethod === 'courier' ? 'Courier' : 'Seller delivery'}
          </dd>
        </>
      )}
      {terms.fulfillment === 'on_campus' ? (
        <>
          <dt>Meeting location</dt>
          <dd>{terms.meetupLocation}</dd>
          <dt>Date / time</dt>
          <dd>
            {new Date(terms.scheduledAt).toLocaleString('en-CA', {
              timeZone: 'America/Toronto',
            })}{' '}
            (Toronto)
          </dd>
        </>
      ) : (
        <>
          <dt>Delivery area</dt>
          <dd>
            {terms.deliveryArea?.cityLabel}, {terms.deliveryArea?.provinceCode}{' '}
            {'\u00b7'} {terms.deliveryArea?.postalPrefix}
          </dd>
        </>
      )}
      {terms.note && (
        <>
          <dt>Note</dt>
          <dd>{terms.note}</dd>
        </>
      )}
    </dl>
  )
}

function OrderEconomics({
  order,
  role,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
}) {
  if (!order.economics || !order.v2)
    return <p role="alert">Economics unavailable. Refresh the Order.</p>
  const money = order.economics
  return (
    <section
      aria-label={role === 'buyer' ? 'Buyer economics' : 'Seller economics'}
    >
      <dl className={styles.amounts}>
        <dt>Agreed item price</dt>
        <dd>{offerAmount(money.itemCents)}</dd>
        {order.v2.terms.fulfillment === 'delivery' && (
          <>
            <dt>Delivery fee</dt>
            <dd>{offerAmount(money.deliveryCents)}</dd>
          </>
        )}
        {role === 'buyer' ? (
          <>
            <dt>Buyer Protection fee</dt>
            <dd>{offerAmount(money.buyerServiceFeeCents)}</dd>
            <dt>Total</dt>
            <dd>{offerAmount(money.buyerTotalCents)}</dd>
          </>
        ) : (
          <>
            <dt>Seller platform fee</dt>
            <dd>{offerAmount(money.sellerPlatformFeeCents)}</dd>
            <dt>Seller transaction amount</dt>
            <dd>{offerAmount(money.sellerGrossCents)}</dd>
          </>
        )}
      </dl>
      {order.v2.terms.paymentMode !== 'external' &&
        order.lifecycle === 'cancelled' &&
        ['pending', 'failed'].includes(order.paymentStatus) &&
        !order.paymentPaidAt && (
          <p>Payment not completed. No payment was charged.</p>
        )}
    </section>
  )
}

function OrderReference({ id }: { id: string }) {
  const number = orderNumber(id)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(timer.current), [])
  return (
    <div className={pageStyles.reference}>
      <div>
        <span className={styles.eyebrow}>Order No.</span>
        <p>{number || 'Order number unavailable'}</p>
      </div>
      <button
        type="button"
        aria-label="Copy order number"
        disabled={!number}
        className={pageStyles.copy}
        data-copy-state={copied ? 'check' : 'copy'}
        onClick={async () => {
          if (!number) return
          try {
            await navigator.clipboard.writeText(number)
            setError('')
            setCopied(true)
            clearTimeout(timer.current)
            // 100ms fade-in followed by a 1000ms fully visible Check.
            timer.current = setTimeout(
              () => setCopied(false),
              copied ||
                window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 1000
                : 1100
            )
          } catch {
            setError('Unable to copy. Select the order number to copy it.')
          }
        }}
      >
        <Copy className={pageStyles.copyIcon} size={16} aria-hidden={true} />
        <Check className={pageStyles.checkIcon} size={16} aria-hidden={true} />
      </button>
      {error && (
        <span role="status" className={pageStyles.copyFeedback}>
          {error}
        </span>
      )}
    </div>
  )
}

type StageProps = {
  order: FormalOrder
  role: 'buyer' | 'seller'
  terms: OfferTerms
  flow: ReturnType<typeof useOrderFlow>
  page: OrderPage
  offset: number
  status: string
}
function AgreementDetails({ order, role, terms, status }: StageProps) {
  const snapshot = order.v2!
  const listing = order.snapshot.listing
  return (
    <section
      className={`${profile.panel} ${pageStyles.details}`}
      aria-label="Agreement / Terms"
    >
      <h4>Agreement / Terms</h4>
      <OrderReference id={order.id} />
      <section aria-label="Original Offer">
        <h5>Original Offer</h5>
        <dl className={styles.amounts}>
          <dt>Original asking price</dt>
          <dd>{offerAmount(snapshot.askingPriceCents)}</dd>
        </dl>
      </section>
      <section aria-label="Confirmed Offer">
        <h5>Confirmed Offer</h5>
        <ExpandedCardPreview
          title="Listing"
          expandedTitle={listing.title}
          className={`${listingWorkspace.inlinePreview} ${styles.compactSummary} ${pageStyles.agreementListing}`}
          media={
            listing.photoUrls.length ? (
              <ListingMedia images={listing.photoUrls} alt={listing.title} />
            ) : (
              <span className={listingWorkspace.photoPlaceholder}>
                No photo available
              </span>
            )
          }
        >
          <dl className={styles.amounts}>
            <dt>Condition</dt>
            <dd>{snapshot.condition}</dd>
            <dt>Category</dt>
            <dd>{listing.category}</dd>
            {snapshot.subcategory && (
              <>
                <dt>Subcategory</dt>
                <dd>{snapshot.subcategory}</dd>
              </>
            )}
          </dl>
          <section aria-label="Listing description">
            <h5>Description</h5>
            <p>{snapshot.description}</p>
          </section>
        </ExpandedCardPreview>
        <dl className={styles.amounts}>
          <dt>Buyer</dt>
          <dd>{order.snapshot.buyer}</dd>
          <dt>Seller</dt>
          <dd>{order.snapshot.seller}</dd>
          <dt>Agreement status</dt>
          <dd>Confirmed</dd>
          <dt>Order status</dt>
          <dd>{status}</dd>
        </dl>
        <OrderEconomics order={order} role={role} />
        {role === 'buyer' &&
          order.economics &&
          snapshot.askingPriceCents > order.economics.itemCents && (
            <p>
              You saved{' '}
              {offerAmount(
                snapshot.askingPriceCents - order.economics.itemCents
              )}
            </p>
          )}
        <ConfirmedFulfillment terms={terms} />
      </section>
    </section>
  )
}
function PaymentDetails({ order, role, flow, offset }: StageProps) {
  const data = flow.data
  const deadline =
    data?.checkout?.paymentDeadlineAt || data?.checkout?.checkoutClaimDeadlineAt
  return (
    <>
      {' '}
      <OrderEconomics order={order} role={role} />
      {order.v2?.terms.paymentMode === 'external' ? (
        <>
          <p>Paid outside UU · No UU payment protection</p>
          <p>
            External exchange:{' '}
            {flow.data?.fulfillment.externalExchange?.status.replaceAll(
              '_',
              ' '
            ) ?? 'Unavailable'}
          </p>
        </>
      ) : (
        <p>Payment: {order.paymentStatus.replaceAll('_', ' ')}</p>
      )}
      {deadline &&
        order.lifecycle === 'open' &&
        ['pending', 'failed'].includes(order.paymentStatus) && (
          <OrderCountdown
            expiresAt={Date.parse(deadline)}
            serverOffsetMs={offset}
            suffix={
              data?.checkout?.checkoutStartedAt
                ? 'payment window remaining'
                : 'to start checkout'
            }
          />
        )}
    </>
  )
}
function ProtectionDetails({ flow, offset }: StageProps) {
  const data = flow.data
  return (
    <>
      {' '}
      <p>
        {data?.fulfillment.protectionHold
          ? 'Protection on hold · Case open'
          : 'Protection active'}
      </p>
      {data?.fulfillment.protectionStartedAt && (
        <p>
          Started:{' '}
          {new Date(data.fulfillment.protectionStartedAt).toLocaleString()}
        </p>
      )}
      {data?.fulfillment.protectionExpiresAt && (
        <OrderCountdown
          expiresAt={Date.parse(data.fulfillment.protectionExpiresAt)}
          serverOffsetMs={offset}
          protection={true}
          suffix="remaining"
        />
      )}
      {data?.fulfillment.caseState && (
        <p>Case status: {data.fulfillment.caseState}</p>
      )}
    </>
  )
}
function CompletionDetails({ order, status, page, flow }: StageProps) {
  return (
    <>
      {' '}
      <p>{status}</p>
      {order.v2?.terms.paymentMode === 'external' ? (
        <>
          <p>Paid outside UU · No UU payment protection</p>
          <p>
            External exchange:{' '}
            {flow.data?.fulfillment.externalExchange?.status.replaceAll(
              '_',
              ' '
            ) ?? 'Unavailable'}
          </p>
        </>
      ) : (
        <p>Payment: {order.paymentStatus.replaceAll('_', ' ')}</p>
      )}
      {order.v2?.terms.paymentMode === 'external' && (
        <>
          {flow.data?.fulfillment.externalExchange?.buyerConfirmedAt && (
            <p>
              Buyer confirmed:{' '}
              {new Date(
                flow.data.fulfillment.externalExchange.buyerConfirmedAt
              ).toLocaleString()}
            </p>
          )}
          {flow.data?.fulfillment.externalExchange?.sellerConfirmedAt && (
            <p>
              Seller confirmed:{' '}
              {new Date(
                flow.data.fulfillment.externalExchange.sellerConfirmedAt
              ).toLocaleString()}
            </p>
          )}
        </>
      )}
      {order.cancellation && (
        <p>
          {order.cancellation.reason} ·{' '}
          {new Date(order.cancellation.at).toLocaleString()}
        </p>
      )}
      {order.expiredAt && (
        <p>Expired: {new Date(order.expiredAt).toLocaleString()}</p>
      )}
      {page === 'completed' && order.v2?.terms.paymentMode !== 'external' && (
        <p>Payout status: {order.payoutStatus.replaceAll('_', ' ')}</p>
      )}
    </>
  )
}
function FulfillmentDetails({ order, role, flow, terms }: StageProps) {
  const data = flow.data
  const campus = terms.fulfillment === 'on_campus'
  const courier =
    terms.fulfillment === 'delivery' && terms.deliveryMethod === 'courier'
  return (
    <>
      {' '}
      <dl className={styles.amounts}>
        <dt>
          <Tag size={16} aria-hidden="true" />
          Agreed item price
        </dt>
        <dd>{offerAmount(terms.itemAmountCents)}</dd>
        {terms.fulfillment === 'on_campus' && (
          <>
            <dt>
              <MapPin size={16} aria-hidden="true" />
              Meeting location
            </dt>
            <dd>{terms.meetupLocation}</dd>
            <dt>
              <CalendarDays size={16} aria-hidden="true" />
              Date / time
            </dt>
            <dd>
              {new Date(terms.scheduledAt).toLocaleString('en-CA', {
                timeZone: 'America/Toronto',
              })}{' '}
              (Toronto)
            </dd>
          </>
        )}
      </dl>
      {!campus && <ConfirmedFulfillment terms={terms} />}
      {!campus && (role === 'buyer' || order.paymentStatus === 'paid') && (
        <PrivateAddress address={data?.checkout || null} />
      )}{' '}
      {!campus && data?.fulfillment.deliveryStartedAt && (
        <p>
          Delivery started:{' '}
          {new Date(data.fulfillment.deliveryStartedAt).toLocaleString()}
        </p>
      )}
      {courier && data?.courier?.shippedAt && (
        <p>
          Shipped · {data.courier.carrierLabel} ·{' '}
          {data.courier.trackingReference}
        </p>
      )}
      {courier && data?.courier?.deliveredAt && (
        <p>Received: {new Date(data.courier.deliveredAt).toLocaleString()}</p>
      )}
      {data?.fulfillment.handoffConfirmedAt && (
        <p>
          Handoff confirmed:{' '}
          {new Date(data.fulfillment.handoffConfirmedAt).toLocaleString()}
        </p>
      )}
    </>
  )
}
export function OrderStageDetails(props: StageProps) {
  if (props.page === 'review') return <AgreementDetails {...props} />
  let title = 'Delivery Details'
  let content = <FulfillmentDetails {...props} />
  if (props.terms.fulfillment === 'on_campus') title = 'Meeting Details'
  else if (props.terms.deliveryMethod === 'courier') title = 'Shipping Details'
  if (props.page === 'payment') {
    title = 'Price Details'
    content = <PaymentDetails {...props} />
  }
  if (props.page === 'protection') {
    title = 'Protection Details'
    content = <ProtectionDetails {...props} />
  }
  if (props.page === 'completed' || props.page === 'closed') {
    title = props.page === 'completed' ? 'Completion Details' : 'Order outcome'
    content = <CompletionDetails {...props} />
  }
  return (
    <section
      className={`${profile.panel} ${pageStyles.details}`}
      aria-label={title}
    >
      <h4>{title}</h4>
      {content}
    </section>
  )
}
