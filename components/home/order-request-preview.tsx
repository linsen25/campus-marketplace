import { ChevronRight } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ListingMedia } from '@/components/listings/listing-media'
import { ListingDetails } from '@/components/listings/published-listing-card'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { ExpandedCardPreview } from '@/components/velora/expandable-card'
import type {
  PreviewRequest,
  PreviewRole,
} from '@/lib/order-interaction-preview'
import {
  parsePreviewCurrency,
  getPreviewRequestSendGate,
  unfinishedRequestMessage,
} from '@/lib/order-interaction-preview'
import {
  formatSchedule,
  isRequestScheduleAvailable,
  validateNewOrderSchedule,
  validateOrderScheduleSnapshot,
} from '@/lib/order-schedule-preview'
import type { ScheduleDraft } from '@/lib/order-schedule-preview'
import {
  fulfillmentLabels,
  compactShippingTerms,
  previewShippingLabel,
  shippingCostLabels,
  formatOrderVisualAmount,
} from '@/lib/order-visual-preview'
import type { OrderRequestVisual } from '@/lib/order-visual-preview'
import { requestCardStatus } from '@/lib/request-card-status'
import type { ChatListing } from '@/types/conversation'
import type { FormalOrder } from '@/types/order'

import workspace from '../listings/listing-workspace.module.css'

import scrollStyles from './animated-sidebar-demo.module.css'
import preview from './messages-listing-preview.module.css'
import { PreviewCancellationDialog } from './order-preview-forms'
import styles from './order-request-preview.module.css'
import { OrderScheduleField } from './order-schedule-field'
import { useOrderVisual } from './order-visual-context'
import profile from './profile.module.css'

export type { OrderRequestVisual } from '@/lib/order-visual-preview'

export function OrderVisualTerms({ draft }: { draft: OrderRequestVisual }) {
  const shipping = draft.fulfillment === 'shipping'
  const meet = draft.fulfillment === 'meet'
  return (
    <dl className={styles.summary}>
      <dt>{shipping ? 'Item price' : 'Agreed price'}</dt>
      <dd>{formatOrderVisualAmount(draft.price)}</dd>
      {!shipping && (
        <>
          <dt>Fulfillment method</dt>
          <dd>{fulfillmentLabels[draft.fulfillment]}</dd>
        </>
      )}
      {shipping ? (
        <>
          <dt>Shipping</dt>
          <dd>{previewShippingLabel(draft)}</dd>
          <dt>Method</dt>
          <dd>Shipping</dd>
          {draft.shippingMethod && (
            <>
              <dt>Shipping method</dt>
              <dd>{draft.shippingMethod}</dd>
            </>
          )}
        </>
      ) : (
        <>
          <dt>{meet ? 'Meeting location' : 'Pickup location'}</dt>
          <dd>{draft.location}</dd>
          <dt>Schedule</dt>
          <dd>{formatSchedule(draft)}</dd>
        </>
      )}
    </dl>
  )
}

function ListingSurface({
  listing,
  children,
  actions,
  verified = false,
  price = listing.price,
  context = false,
  concise = false,
}: {
  listing: ChatListing
  children?: ReactNode
  actions?: ReactNode
  verified?: boolean
  price?: number
  concise?: boolean
  context?: boolean
}) {
  return (
    <ExpandedCardPreview
      className={`${workspace.inlinePreview} ${preview.card} ${styles.card} ${
        context ? styles.contextCard : ''
      } ${concise ? styles.agreedTermsCard : ''}`}
      title={formatOrderVisualAmount(price)}
      expandedTitle={listing.title}
      topAction={
        verified ? (
          <span
            className={styles.verified}
            title="Official Campus Marketplace Order Request origin only. Not seller identity, item authenticity, safety or payment verification."
          >
            ✓ Verified
          </span>
        ) : undefined
      }
      media={
        listing.photoUrls.length ? (
          <ListingMedia images={listing.photoUrls} alt={listing.title} />
        ) : (
          <span className={workspace.photoPlaceholder}>No photo available</span>
        )
      }
      actions={actions && <div className={styles.actions}>{actions}</div>}
    >
      {!concise && listing.live ? (
        <ListingDetails listing={listing.live} />
      ) : (
        <p>{listing.category} · Original listing details</p>
      )}
      {children}
    </ExpandedCardPreview>
  )
}

function editorErrors(
  priceCents: number | null,
  feeCents: number | null,
  shipping: boolean,
  location: string,
  shippingCost: OrderRequestVisual['shippingCost']
) {
  const priceError =
    priceCents === null
      ? 'Enter a price greater than zero, with up to two decimal places.'
      : ''
  let fulfillmentError = !location.trim() ? 'Enter a location.' : ''
  if (shipping)
    fulfillmentError =
      shippingCost === 'flat' && feeCents === null
        ? 'Enter a nonnegative shipping fee with up to two decimal places.'
        : ''
  return { priceError, fulfillmentError }
}

// eslint-disable-next-line complexity -- Keep the existing fulfillment form and normal/replacement confirmation guards together.
export function OrderRequestEditor({
  listing,
  conversationId,
  buyerId,
  sellerId,
  onClose,
  onPreview,
  formalRequests,
}: {
  listing: ChatListing
  onClose: () => void
  conversationId: string
  buyerId: string
  sellerId: string
  onPreview: (
    draft: OrderRequestVisual,
    replaceRequestId?: string
  ) => Promise<string | null> | string | null
  formalRequests?: readonly PreviewRequest[]
}) {
  const id = useId()
  const confirmed = useRef(false)
  const [sending, setSending] = useState(false)
  const visuals = useOrderVisual()
  const [replaceRequestId, setReplaceRequestId] = useState<string | null>(null)
  const [price, setPrice] = useState((listing.price / 100).toFixed(2))
  const [method, setMethod] =
    useState<OrderRequestVisual['fulfillment']>('pickup')
  const [handoff, setHandoff] = useState<
    Record<'meet' | 'pickup', { location: string; schedule: ScheduleDraft }>
  >({
    pickup: {
      location: listing.live?.pickupArea || '',
      schedule: { mode: 'scheduled', time: '' },
    },
    meet: {
      location: listing.live?.pickupArea || '',
      schedule: { mode: 'scheduled', time: '' },
    },
  })
  const [now, setNow] = useState(() => new Date())
  const [confirmationError, setConfirmationError] = useState('')
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const [shippingCost, setShippingCost] =
    useState<OrderRequestVisual['shippingCost']>('included')
  const [shippingFee, setShippingFee] = useState('0')
  const [shippingMethod, setShippingMethod] = useState('')
  const [note, setNote] = useState('')
  const [confirmation, setConfirmation] = useState<OrderRequestVisual | null>(
    null
  )
  const shipping = method === 'shipping'
  const meet = method === 'meet'
  const selected = meet ? 'meet' : 'pickup'
  const { location, schedule } = handoff[selected]
  const priceCents = parsePreviewCurrency(price, Boolean(formalRequests))
  const feeCents = parsePreviewCurrency(shippingFee, true)
  const { priceError, fulfillmentError } = editorErrors(
    priceCents,
    feeCents,
    shipping,
    location,
    shippingCost
  )
  const scheduleResult = validateNewOrderSchedule(schedule, now)
  const scheduleError =
    !shipping && !scheduleResult.valid ? scheduleResult.message : ''
  const gate = getPreviewRequestSendGate(
    formalRequests
      ? { requests: [...formalRequests], orders: [] }
      : visuals.state,
    { conversationId, buyerId, sellerId, listingId: listing.id },
    now.getTime()
  )
  let dialogTitle = 'Order Request editor'
  if (confirmation) dialogTitle = 'Confirm Order Request'
  if (replaceRequestId) dialogTitle = 'Replace current Order Request?'
  const submitLabel = replaceRequestId ? 'Replace & Send' : 'Confirm & Send'
  const scrollIdle = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => () => clearTimeout(scrollIdle.current), [])
  const valid =
    !priceError && !fulfillmentError && !scheduleError && !gate.blocked
  const cancelConfirmation = () => {
    setReplaceRequestId(null)
    setConfirmation(null)
    setConfirmationError('')
  }
  return (
    <FadingDialog
      className={confirmation ? workspace.confirmation : styles.editorModal}
      aria-label={dialogTitle}
      onRequestClose={() => (confirmation ? cancelConfirmation() : onClose())}
    >
      {confirmation ? (
        <>
          <h3>
            {replaceRequestId
              ? 'Replace current Order Request?'
              : 'Confirm Order Request'}
          </h3>
          {replaceRequestId && (
            <p className={styles.warning}>
              Sending this request will replace the current active request. The
              previous request will remain visible in the conversation but can
              no longer be accepted.
            </p>
          )}
          <p className={styles.confirmListing}>{listing.title}</p>
          <OrderVisualTerms draft={confirmation} />
          <p className={styles.warning}>
            Once sent, this request cannot be edited.
          </p>
          {!formalRequests && (
            <p className={styles.notice}>
              Preview only. Nothing will be sent or saved.
            </p>
          )}
          {confirmationError && (
            <p className={profile.error} role="alert">
              {confirmationError}
            </p>
          )}
          <ActionRow>
            <CardAction variant="red" onClick={cancelConfirmation}>
              {replaceRequestId ? 'Cancel' : 'Go Back'}
            </CardAction>
            <CardAction
              variant="green"
              disabled={sending}
              aria-busy={sending}
              onClick={async () => {
                if (confirmed.current) return
                const checked = validateOrderScheduleSnapshot(
                  confirmation,
                  new Date()
                )
                if (confirmation.fulfillment !== 'shipping' && !checked.valid) {
                  setConfirmationError(checked.message)
                  return
                }
                if (gate.blocked) {
                  setConfirmationError(unfinishedRequestMessage)
                  return
                }
                if (!replaceRequestId && gate.active) {
                  setReplaceRequestId(gate.active.id)
                  return
                }
                confirmed.current = true
                setSending(true)
                try {
                  const error = await onPreview(
                    confirmation,
                    replaceRequestId || undefined
                  )
                  if (error) {
                    confirmed.current = false
                    setConfirmationError(error)
                  }
                } catch {
                  confirmed.current = false
                  setConfirmationError(
                    'Unable to send. Please retry the same request.'
                  )
                } finally {
                  setSending(false)
                }
              }}
            >
              {sending ? 'Sending...' : submitLabel}
            </CardAction>
          </ActionRow>
        </>
      ) : (
        <>
          <header className={styles.editorHeader}>
            <h3>Order Request</h3>
            <p className={styles.notice}>
              {formalRequests
                ? 'For this conversation\u0027s listing'
                : 'Preview only · For this conversation\u0027s listing'}
            </p>
          </header>
          <div className={`${workspace.builder} ${styles.editorBody}`}>
            <form
              id={id}
              className={`${workspace.form} ${styles.editorForm} ${scrollStyles.scrollbar}`}
              aria-label="Order transaction details"
              onScroll={(event) => {
                const element = event.currentTarget
                element.dataset.scrolling = 'true'
                clearTimeout(scrollIdle.current)
                scrollIdle.current = setTimeout(() => {
                  delete element.dataset.scrolling
                }, 600)
              }}
              onSubmit={(event) => {
                event.preventDefault()
                const checked = validateNewOrderSchedule(schedule, new Date())
                if (!valid || (!shipping && !checked.valid)) return
                setConfirmationError('')
                setConfirmation({
                  price: Number(priceCents),
                  fulfillment: method,
                  location: location.trim(),
                  scheduleMode: shipping ? 'tbd' : 'scheduled',
                  ...(checked.valid && !shipping && checked.scheduledAt
                    ? { scheduledAt: checked.scheduledAt.getTime() }
                    : {}),
                  shippingCost,
                  shippingFee:
                    shipping && shippingCost === 'arranged' ? null : 0,
                  ...(shipping && shippingCost === 'flat'
                    ? { shippingFee: feeCents }
                    : {}),
                  shippingMethod: shippingMethod.trim(),
                  note: note.trim(),
                })
              }}
            >
              <fieldset>
                <legend className={styles.heading}>Transaction details</legend>
                <label className={workspace.field}>
                  Agreed price (CAD)
                  <input
                    type="number"
                    min="0.01"
                    max="1000000"
                    step="0.01"
                    required={true}
                    inputMode="decimal"
                    value={price}
                    onChange={(event) => setPrice(event.target.value)}
                  />
                </label>
                {priceError && (
                  <p className={profile.error} role="status">
                    {priceError}
                  </p>
                )}
                <div className={workspace.field}>
                  <span>How will the buyer receive the item?</span>
                  <div
                    className={profile.segment}
                    role="group"
                    aria-label="Fulfillment method"
                  >
                    {(['pickup', 'meet', 'shipping'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={method === value}
                        onClick={() => setMethod(value)}
                      >
                        {fulfillmentLabels[value]}
                      </button>
                    ))}
                  </div>
                </div>
                {shipping ? (
                  <>
                    <div className={workspace.field}>
                      <span>Shipping cost</span>
                      <div
                        className={profile.segment}
                        role="group"
                        aria-label="Shipping cost"
                      >
                        {(['included', 'flat', 'arranged'] as const).map(
                          (value) => (
                            <button
                              key={value}
                              type="button"
                              aria-pressed={shippingCost === value}
                              onClick={() => setShippingCost(value)}
                            >
                              {shippingCostLabels[value]}
                            </button>
                          )
                        )}
                      </div>
                    </div>
                    {shippingCost === 'flat' && (
                      <>
                        <label className={workspace.field}>
                          Shipping fee (CAD)
                          <input
                            type="number"
                            min="0"
                            max="1000000"
                            step="0.01"
                            required={true}
                            inputMode="decimal"
                            value={shippingFee}
                            onChange={(event) =>
                              setShippingFee(event.target.value)
                            }
                          />
                        </label>
                        <p className={workspace.hint}>
                          You are responsible for any difference in the
                          carrier&apos;s actual cost.
                        </p>
                      </>
                    )}
                    {shippingCost === 'arranged' && (
                      <p className={workspace.hint}>
                        The final shipping cost must be agreed before payment.
                      </p>
                    )}
                    <label className={workspace.field}>
                      Shipping method
                      <input
                        maxLength={160}
                        placeholder="e.g. Tracked shipping"
                        value={shippingMethod}
                        onChange={(event) =>
                          setShippingMethod(event.target.value)
                        }
                      />
                    </label>
                    <p className={workspace.hint}>
                      Buyer will provide their shipping address after accepting
                      the order.
                    </p>
                  </>
                ) : (
                  <>
                    <label className={workspace.field}>
                      {meet ? 'Meeting location' : 'Pickup location'}
                      <input
                        required={true}
                        maxLength={160}
                        value={location}
                        onChange={(event) =>
                          setHandoff({
                            ...handoff,
                            [selected]: {
                              ...handoff[selected],
                              location: event.target.value,
                            },
                          })
                        }
                      />
                    </label>
                    <OrderScheduleField
                      key={selected}
                      value={schedule}
                      now={now}
                      onChange={(value) =>
                        setHandoff({
                          ...handoff,
                          [selected]: { ...handoff[selected], schedule: value },
                        })
                      }
                    />
                    {scheduleError && (
                      <p className={profile.error} role="status">
                        {scheduleError}
                      </p>
                    )}
                    <p className={workspace.hint}>
                      {meet
                        ? 'Choose a safe, public meeting location.'
                        : 'Choose a safe, public pickup location when possible.'}
                    </p>
                  </>
                )}
                {gate.blocked && (
                  <p className={profile.error} role="status">
                    {unfinishedRequestMessage} Do not create another Order
                    Request until the current order is no longer active.
                  </p>
                )}
                {fulfillmentError && (
                  <p className={profile.error} role="status">
                    {fulfillmentError}
                  </p>
                )}
                <label className={workspace.field}>
                  Optional note
                  <textarea
                    rows={3}
                    maxLength={1000}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
              </fieldset>
            </form>
            <div className={styles.listingContext}>
              <p className={styles.contextLabel}>Current listing</p>
              <ListingSurface listing={listing} context={true} />
            </div>
          </div>
          <footer className={styles.editorFooter}>
            <ActionRow>
              <CardAction variant="red" onClick={onClose}>
                Cancel
              </CardAction>
              <CardAction
                variant="green"
                type="submit"
                form={id}
                disabled={!valid}
              >
                Send Request
              </CardAction>
            </ActionRow>
          </footer>
        </>
      )}
    </FadingDialog>
  )
}

// eslint-disable-next-line complexity -- Keep rich-message terminal status and the existing expand/cancellation dialogs together.
export function OrderRequestPreviewCard({
  request,
  role,
  formal = false,
  onCancel,
  onAccept,
  onViewOrder,
  acceptancePendingRefresh = false,
  linkedOrder,
}: {
  role: PreviewRole
  request: PreviewRequest
  formal?: boolean
  onCancel?: (reason: string, note: string) => Promise<void>
  onViewOrder?: () => void
  onAccept?: () => Promise<void>
  acceptancePendingRefresh?: boolean
  linkedOrder?: Pick<
    FormalOrder,
    'cancellation' | 'lifecycle' | 'paymentStatus'
  >
}) {
  const { listing, draft } = request.snapshot
  const presentation = requestCardStatus(
    request.status,
    formal ? linkedOrder : undefined
  )
  const orderOutcome = formal ? presentation.outcome : null
  const [expanded, setExpanded] = useState(false)
  const [cancellationOpen, setCancellationOpen] = useState(false)
  const [acceptOpen, setAcceptOpen] = useState(false)
  const [acceptBusy, setAcceptBusy] = useState(false)
  const [acceptError, setAcceptError] = useState('')
  const acceptLock = useRef(false)
  const pendingShipping =
    draft.fulfillment === 'shipping' && draft.shippingCost === 'arranged'
  const acceptLabel = pendingShipping ? 'Accept Order' : 'Accept & Reserve'
  const visuals = useOrderVisual()
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])
  const available = isRequestScheduleAvailable(draft, now)
  const expired =
    request.status === 'expired' ||
    (!formal && !available && request.status === 'active')
  const previewStatus = expired
    ? 'Expired'
    : {
        active: 'Active',
        superseded: 'Replaced',
        accepted: 'Accepted',
        expired: 'Expired',
        cancelled: 'Cancelled',
      }[request.status]
  const terms =
    draft.fulfillment === 'shipping'
      ? compactShippingTerms(draft)
      : `${formatOrderVisualAmount(draft.price)} · ${
          draft.fulfillment === 'meet' ? 'Meet' : 'Pickup'
        } · ${draft.location}`
  return (
    <div
      className={styles.localPreview}
      data-order-preview={request.id}
      data-request-status={request.status}
      data-request-tone={formal ? presentation.tone : undefined}
    >
      <div className={styles.requestMeta}>
        {!formal && <p className={styles.notice}>Preview only · Not sent</p>}
        <span className={`${profile.verified} ${styles.status}`}>
          {formal ? presentation.primary : previewStatus}
        </span>
      </div>
      <button
        type="button"
        className={styles.collapsed}
        aria-label={
          formal ? 'Expand Order Request' : 'Expand Order Request preview'
        }
        onClick={() => setExpanded(true)}
      >
        <span>
          <strong>Order Request</strong>
          {formal && presentation.secondary && (
            <span className={styles.location}>{presentation.secondary}</span>
          )}
          <span className={styles.location}>{terms}</span>
          {draft.fulfillment !== 'shipping' && (
            <span className={styles.location}>{formatSchedule(draft)}</span>
          )}
        </span>
        <ChevronRight size={20} aria-hidden="true" />
      </button>
      {expanded && (
        <FadingDialog
          className={`${styles.modal} ${formal ? styles.agreedTermsModal : ''}`}
          aria-label={formal ? 'Order Request' : 'Order Request preview'}
          onRequestClose={() => setExpanded(false)}
        >
          <ListingSurface
            listing={listing}
            price={draft.price}
            verified={true}
            concise={formal}
            actions={
              <ActionRow>
                <CardAction variant="red" onClick={() => setExpanded(false)}>
                  Close
                </CardAction>
                {formal &&
                  request.status === 'accepted' &&
                  onViewOrder &&
                  (orderOutcome ? (
                    <CardAction variant="green" onClick={onViewOrder}>
                      View details
                    </CardAction>
                  ) : (
                    <CardAction variant="green" onClick={onViewOrder}>
                      View Order
                    </CardAction>
                  ))}
                {formal &&
                  role === 'buyer' &&
                  request.status === 'active' &&
                  !acceptancePendingRefresh &&
                  onAccept && (
                    <CardAction
                      variant="green"
                      onClick={() => {
                        setExpanded(false)
                        setAcceptError('')
                        setAcceptOpen(true)
                      }}
                    >
                      Accept
                    </CardAction>
                  )}
                {!formal &&
                  visuals.enabled &&
                  role === 'buyer' &&
                  request.status === 'active' &&
                  available && (
                    <CardAction
                      variant="blue"
                      title="Buyer perspective · Local preview acceptance only"
                      onClick={() => {
                        setExpanded(false)
                        visuals.accept(request.id, role)
                      }}
                    >
                      Accept
                    </CardAction>
                  )}
              </ActionRow>
            }
          >
            {formal && (
              <dl className={styles.summary} aria-label="Request lifecycle">
                <dt>Request status</dt>
                <dd>
                  {
                    {
                      active: 'Active',
                      superseded: 'Replaced',
                      cancelled: 'Cancelled',
                      expired: 'Expired',
                      accepted: 'Accepted',
                    }[request.status]
                  }
                </dd>
                {orderOutcome && (
                  <>
                    <dt>Order outcome</dt>
                    <dd>{orderOutcome}</dd>
                  </>
                )}
              </dl>
            )}
            {!formal && request.status === 'superseded' && (
              <p className={styles.notice}>
                This request was replaced by a newer Order Request.
              </p>
            )}
            {!formal && request.status === 'cancelled' && (
              <p className={styles.notice}>
                This Order Request was cancelled by the seller.
              </p>
            )}
            {!formal && request.cancellation && (
              <p className={styles.notice}>
                Reason: {request.cancellation.cancelReason}
                {request.cancellation.cancelNote && (
                  <>
                    <br />
                    {request.cancellation.cancelNote}
                  </>
                )}
              </p>
            )}
            {!formal && expired && (
              <p className={styles.notice}>
                Scheduled time passed. This request can no longer be accepted.
              </p>
            )}
            <h4 className={styles.heading}>Agreed transaction terms</h4>
            <OrderVisualTerms draft={draft} />
            {draft.note && (
              <>
                <h4 className={styles.heading}>Seller note</h4>
                <p className={styles.note}>{draft.note}</p>
              </>
            )}
            <p className={styles.notice}>
              {!formal && 'Preview only · '}Verified describes official request
              origin, not the seller, item, safety or payment.
            </p>
          </ListingSurface>
        </FadingDialog>
      )}
      {acceptOpen && formal && (
        <FadingDialog
          className={profile.dialog}
          aria-label="Accept this Order Request?"
          onRequestClose={() => {
            if (!acceptLock.current) setAcceptOpen(false)
          }}
        >
          <h3 className={styles.heading}>Accept this Order Request?</h3>
          <p>{listing.title}</p>
          <OrderVisualTerms draft={draft} />
          <p className={styles.warning}>
            {draft.fulfillment === 'shipping' &&
            draft.shippingCost === 'arranged'
              ? 'Accepting will create an Order with shipping cost pending. This will not reserve the listing. Shipping cost must be agreed before payment.'
              : 'Accepting will create an Order and reserve this listing for you for 30 minutes.'}
          </p>
          <p>You will not be charged yet.</p>
          {acceptError && <p role="alert">{acceptError}</p>}
          <ActionRow>
            <CardAction
              variant="red"
              disabled={acceptBusy}
              onClick={() => setAcceptOpen(false)}
            >
              Cancel
            </CardAction>
            <CardAction
              variant="green"
              disabled={acceptBusy || request.status !== 'active' || !onAccept}
              onClick={async () => {
                if (acceptLock.current || !onAccept) return
                acceptLock.current = true
                setAcceptBusy(true)
                setAcceptError('')
                try {
                  await onAccept()
                  setAcceptOpen(false)
                } catch (error) {
                  setAcceptError(
                    error instanceof Error
                      ? error.message
                      : 'Unable to accept this Request. Refresh and review its current state.'
                  )
                } finally {
                  acceptLock.current = false
                  setAcceptBusy(false)
                }
              }}
            >
              {acceptBusy ? 'Accepting...' : acceptLabel}
            </CardAction>
          </ActionRow>
        </FadingDialog>
      )}
      {formal && acceptancePendingRefresh && (
        <p className={styles.notice} role="status">
          Acceptance succeeded. Waiting for refreshed Request state; Accept is
          unavailable.
        </p>
      )}
      {!formal && request.status === 'superseded' && (
        <p className={styles.notice}>
          This request was replaced by a newer Order Request.
        </p>
      )}
      {!formal && expired && (
        <p className={styles.notice}>
          Scheduled time passed. This request can no longer be accepted.
        </p>
      )}
      {!formal && request.status === 'cancelled' && (
        <p className={styles.notice}>
          This Order Request was cancelled by the seller.
        </p>
      )}
      {!formal && request.cancellation && (
        <p className={styles.notice}>
          Reason: {request.cancellation.cancelReason}
          {request.cancellation.cancelNote && (
            <>
              <br />
              {request.cancellation.cancelNote}
            </>
          )}
        </p>
      )}
      {cancellationOpen && (
        <PreviewCancellationDialog
          kind="request"
          role={role}
          formal={formal}
          onClose={() => setCancellationOpen(false)}
          onConfirm={async (reason, note) => {
            if (formal) {
              await onCancel?.(reason, note)
              setCancellationOpen(false)
              return
            }
            visuals.cancelRequest(request.id, role, reason, note)
            setCancellationOpen(false)
          }}
        />
      )}
      <div className={styles.previewLinks}>
        {(formal ? Boolean(onCancel) : visuals.enabled) &&
          role === 'seller' &&
          request.status === 'active' &&
          available && (
            <button
              type="button"
              className={styles.dismiss}
              onClick={() => setCancellationOpen(true)}
            >
              Cancel Request
            </button>
          )}
        {!formal && request.status === 'accepted' && (
          <button
            type="button"
            className={styles.dismiss}
            onClick={() => {
              const order = visuals.state.orders.find(
                (value) => value.requestId === request.id
              )
              if (order) visuals.open(order.id)
            }}
          >
            Review Order Detail
          </button>
        )}
      </div>
    </div>
  )
}
