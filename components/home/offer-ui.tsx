import { ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ListingMedia } from '@/components/listings/listing-media'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { offerAmount, parseOfferAmount } from '@/lib/offer-amount'
import {
  combineLocalDateAndTime,
  validateNewOrderSchedule,
} from '@/lib/order-schedule-preview'
import type { ScheduleDraft } from '@/lib/order-schedule-preview'
import type { ChatListing } from '@/types/conversation'
import type { Offer, OfferTerms } from '@/types/offer'

import workspace from '../listings/listing-workspace.module.css'

import styles from './offer-ui.module.css'
import requestStyles from './order-request-preview.module.css'
import { OrderScheduleField } from './order-schedule-field'
import profile from './profile.module.css'

function decimal(cents: number) {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`
}
function OfferMedia({ listing }: { listing: ChatListing }) {
  return (
    <div className={styles.media}>
      {listing.photoUrls.length ? (
        <ListingMedia images={listing.photoUrls} alt={listing.title} />
      ) : (
        <span className={workspace.photoPlaceholder}>No photo available</span>
      )}
    </div>
  )
}
function offerExplanation(status: Offer['status']) {
  if (status === 'Accepted')
    return 'This offer was accepted. View the Order for transaction details.'
  if (status === 'Closed') return 'Listing no longer available'
  return 'A proposal only. No charge or Order has been created.'
}
export function OfferTermsSummary({ terms }: { terms: OfferTerms }) {
  return (
    <dl className={styles.terms}>
      <dt>Item offer</dt>
      <dd>{offerAmount(terms.itemAmountCents)}</dd>
      <dt>Fulfillment</dt>
      <dd>{terms.fulfillment === 'on_campus' ? 'On Campus' : 'Delivery'}</dd>
      {terms.fulfillment === 'on_campus' ? (
        <>
          <dt>Meetup location</dt>
          <dd>{terms.meetupLocation}</dd>
          <dt>Meetup date / time</dt>
          <dd>
            {new Date(terms.scheduledAt).toLocaleString('en-CA', {
              timeZone: 'America/Toronto',
              dateStyle: 'medium',
              timeStyle: 'short',
            })}{' '}
            (Toronto)
          </dd>
        </>
      ) : (
        <>
          <dt>Delivery fee</dt>
          <dd>{offerAmount(terms.deliveryFeeCents)}</dd>
          <dt>Delivery method</dt>
          <dd>
            {terms.deliveryMethod === 'courier'
              ? 'Courier / shipping'
              : 'Seller delivery'}
          </dd>
        </>
      )}
      {terms.note && (
        <>
          <dt>
            {terms.fulfillment === 'delivery'
              ? 'Delivery note / terms'
              : 'Note'}
          </dt>
          <dd className={styles.note}>{terms.note}</dd>
        </>
      )}
    </dl>
  )
}
// eslint-disable-next-line complexity -- Offer lifecycle actions, recipient confirmation and async barriers share the existing card surface.
export function OfferCard({
  offer,
  listing,
  viewerId,
  blocked,
  canEdit,
  onEdit,
  onWithdraw,
  onAccept,
  onViewOrder,
}: {
  offer: Offer
  listing: ChatListing
  viewerId: string
  canEdit: boolean
  blocked: boolean
  onEdit: (offer: Offer) => void
  onWithdraw: (offer: Offer) => Promise<void>
  onAccept?: (offer: Offer, command: string) => Promise<void>
  onViewOrder?: (offer: Offer) => void
}) {
  const [open, setOpen] = useState(false)
  const [withdraw, setWithdraw] = useState(false)
  const [confirmAccept, setConfirmAccept] = useState(false)
  const accepted = useRef(false)
  const acceptCommand = useRef<string>()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const sending = useRef(false)
  const own = offer.senderId === viewerId
  const active = offer.status === 'Active' && !blocked && !accepted.current
  const terms = offer.terms
  const direction =
    offer.senderId === offer.buyerId ? 'Buyer offer' : 'Seller offer'
  const deliveryLabel =
    terms.fulfillment === 'delivery' && terms.deliveryMethod === 'courier'
      ? 'Courier / shipping'
      : 'Seller delivery'
  const close = () => {
    if (!pending) setOpen(false)
  }
  return (
    <div
      className={styles.timelineCard}
      data-offer-id={offer.id}
      data-offer-status={offer.status}
    >
      <button
        className={`${requestStyles.collapsed} ${
          offer.status !== 'Active' ? styles.terminal : ''
        }`}
        type="button"
        aria-label={`Open ${direction}: ${offer.status}`}
        onClick={() => setOpen(true)}
      >
        <span>
          <span className={requestStyles.status}>{offer.status}</span>
          <strong>Offer</strong>
          <small>{direction}</small>
          <span>
            {offerAmount(terms.itemAmountCents)}
            {terms.fulfillment === 'delivery'
              ? ` + ${offerAmount(terms.deliveryFeeCents)} delivery`
              : ' · On Campus'}
          </span>
          <span className={requestStyles.location}>
            {terms.fulfillment === 'on_campus'
              ? `${terms.meetupLocation} · ${new Date(
                  terms.scheduledAt
                ).toLocaleString('en-CA', {
                  timeZone: 'America/Toronto',
                  month: 'short',
                  day: 'numeric',
                  hour: 'numeric',
                  minute: '2-digit',
                })}`
              : deliveryLabel}
          </span>
        </span>
        <ChevronRight size={18} aria-hidden="true" />
      </button>
      {open && (
        <FadingDialog
          className={styles.dialog}
          aria-labelledby={`offer-${offer.id}`}
          onRequestClose={close}
        >
          <header>
            <h3 id={`offer-${offer.id}`}>Offer · {offer.status}</h3>
            <p>{direction}</p>
          </header>
          <div className={styles.expanded}>
            <OfferMedia listing={listing} />
            <section>
              <h4>{listing.title}</h4>
              <OfferTermsSummary terms={terms} />
              <p className={workspace.hint}>{offerExplanation(offer.status)}</p>
            </section>
          </div>
          {error && <p role="alert">{error}</p>}
          <ActionRow>
            <CardAction variant="red" disabled={pending} onClick={close}>
              Close
            </CardAction>
            {offer.status === 'Accepted' && offer.linkedOrderId && onViewOrder && (
              <CardAction variant="green" onClick={() => onViewOrder(offer)}>
                View Order
              </CardAction>
            )}
            {active && !own && offer.recipientId === viewerId && onAccept && (
              <CardAction
                variant="green"
                disabled={!offer.canAccept || pending}
                onClick={() => setConfirmAccept(true)}
              >
                Accept
              </CardAction>
            )}
            {active && offer.acceptBlockReason === 'listing_changed' && (
              <p>
                Listing changed since this offer. Review the updated listing and
                send a new offer.
              </p>
            )}
            {active && offer.acceptBlockReason === 'asking_price_lower' && (
              <p>
                The current asking price is lower than this offer. Send a new
                offer.
              </p>
            )}
            {active && (
              <>
                <CardAction
                  disabled={!canEdit}
                  variant="green"
                  onClick={() => {
                    setOpen(false)
                    onEdit(offer)
                  }}
                >
                  {own ? 'Revise Offer' : 'Counter Offer'}
                </CardAction>
                {own && (
                  <CardAction variant="red" onClick={() => setWithdraw(true)}>
                    Withdraw Offer
                  </CardAction>
                )}
              </>
            )}
          </ActionRow>
        </FadingDialog>
      )}
      {confirmAccept && (
        <FadingDialog
          className={styles.confirm}
          aria-labelledby={`accept-${offer.id}`}
          onRequestClose={() => {
            if (!pending) setConfirmAccept(false)
          }}
        >
          <h3 id={`accept-${offer.id}`}>Accept this offer?</h3>
          <OfferTermsSummary terms={terms} />
          <p>
            {terms.fulfillment === 'on_campus'
              ? 'Accepting creates an Order and reserves the Listing for the agreed meetup. You will inspect the item before payment. You will not be charged now.'
              : 'Accepting creates an Order and reserves the Listing. Payment will be required before Delivery. You will not be charged merely by accepting this Offer.'}
          </p>
          <ActionRow>
            <CardAction
              variant="red"
              disabled={pending}
              onClick={() => setConfirmAccept(false)}
            >
              Cancel
            </CardAction>
            <CardAction
              variant="green"
              disabled={
                pending || blocked || accepted.current || !offer.canAccept
              }
              onClick={async () => {
                if (
                  sending.current ||
                  blocked ||
                  accepted.current ||
                  !offer.canAccept ||
                  own ||
                  offer.recipientId !== viewerId ||
                  !onAccept
                )
                  return
                sending.current = true
                setPending(true)
                setError('')
                acceptCommand.current ||= crypto.randomUUID()
                try {
                  await onAccept(offer, acceptCommand.current)
                  accepted.current = true
                  setConfirmAccept(false)
                  setOpen(false)
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Unable to accept Offer.'
                  )
                } finally {
                  sending.current = false
                  setPending(false)
                }
              }}
            >
              {pending ? 'Accepting?' : 'Accept & Reserve'}
            </CardAction>
          </ActionRow>
          {error && <p role="alert">{error}</p>}
        </FadingDialog>
      )}
      {withdraw && (
        <FadingDialog
          className={styles.confirm}
          aria-labelledby={`withdraw-${offer.id}`}
          onRequestClose={() => {
            if (!pending) setWithdraw(false)
          }}
        >
          <h3 id={`withdraw-${offer.id}`}>Withdraw this offer?</h3>
          <p>
            This offer will no longer be available for the other person to
            accept. You can make a new offer later.
          </p>
          <ActionRow>
            <CardAction
              variant="green"
              disabled={pending}
              onClick={() => setWithdraw(false)}
            >
              Keep offer
            </CardAction>
            <CardAction
              variant="red"
              disabled={pending || blocked}
              onClick={async () => {
                if (sending.current || blocked) return
                sending.current = true
                setPending(true)
                setError('')
                try {
                  await onWithdraw(offer)
                  setWithdraw(false)
                  setOpen(false)
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Unable to withdraw Offer.'
                  )
                } finally {
                  sending.current = false
                  setPending(false)
                }
              }}
            >
              {pending ? 'Withdrawing…' : 'Withdraw offer'}
            </CardAction>
          </ActionRow>
          {error && <p role="alert">{error}</p>}
        </FadingDialog>
      )}
    </div>
  )
}
// eslint-disable-next-line complexity -- Two discriminated fulfillment drafts retain independent values and share one confirmation flow.
export function OfferEditor({
  listing,
  initial,
  viewerId,
  onClose,
  onSend,
}: {
  listing: ChatListing
  initial?: Offer
  viewerId: string
  onClose: () => void
  onSend: (terms: OfferTerms) => Promise<void>
}) {
  const original = initial?.terms
  const [price, setPrice] = useState(
    decimal(original?.itemAmountCents ?? listing.price)
  )
  const [mode, setMode] = useState<'delivery' | 'on_campus' | null>(
    original?.fulfillment ?? null
  )
  const [location, setLocation] = useState(
    original?.fulfillment === 'on_campus' ? original.meetupLocation : ''
  )
  const date =
    original?.fulfillment === 'on_campus'
      ? new Date(original.scheduledAt)
      : undefined
  const [schedule, setSchedule] = useState<ScheduleDraft>({
    mode: 'scheduled',
    date,
    time: date
      ? `${String(date.getHours()).padStart(2, '0')}:${String(
          date.getMinutes()
        ).padStart(2, '0')}`
      : '',
  })
  const [fee, setFee] = useState(
    original?.fulfillment === 'delivery'
      ? decimal(original.deliveryFeeCents)
      : ''
  )
  const [method, setMethod] = useState<'' | 'courier' | 'seller_delivery'>(
    original?.fulfillment === 'delivery' ? original.deliveryMethod : ''
  )
  const [note, setNote] = useState(original?.note ?? '')
  const [confirmation, setConfirmation] = useState<OfferTerms | null>(null)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const lock = useRef(false)
  const snapshot = JSON.stringify([
    price,
    mode,
    location,
    schedule,
    fee,
    method,
    note,
  ])
  const initialDraft = useRef(snapshot)
  const close = () => {
    if (pending) return
    if (snapshot !== initialDraft.current) setDiscard(true)
    else onClose()
  }
  const responseTitle =
    initial?.senderId === viewerId ? 'Revise Offer' : 'Counter Offer'
  const responseAction =
    initial?.senderId === viewerId ? 'Send Revised Offer' : 'Send Counter Offer'
  const action = initial ? responseAction : 'Send Offer'
  const review = () => {
    const amount = parseOfferAmount(price)
    const deliveryFee = parseOfferAmount(fee, true)
    if (amount === null) {
      setError('Enter a positive CA$ amount with up to two decimal places.')
      return
    }
    if (!mode) {
      setError('Choose On Campus or Delivery.')
      return
    }
    const common = {
      itemAmountCents: amount,
      currency: 'CAD' as const,
      note: note.trim(),
    }
    if (mode === 'on_campus') {
      const valid = validateNewOrderSchedule(schedule)
      if (!location.trim() || !valid.valid) {
        const scheduleError = !valid.valid
          ? valid.message
          : 'Check meetup details.'
        setError(
          !location.trim() ? 'Enter a public meetup location.' : scheduleError
        )
        return
      }
      const scheduled =
        schedule.date && combineLocalDateAndTime(schedule.date, schedule.time)
      if (!scheduled) return
      setConfirmation({
        ...common,
        fulfillment: 'on_campus',
        meetupLocation: location.trim(),
        scheduledAt: scheduled.toISOString(),
      })
    } else {
      if (
        deliveryFee === null ||
        !method ||
        !Number.isSafeInteger(amount + deliveryFee)
      ) {
        setError(
          'Enter a nonnegative Delivery fee and choose a Delivery method.'
        )
        return
      }
      setConfirmation({
        ...common,
        fulfillment: 'delivery',
        deliveryFeeCents: deliveryFee,
        deliveryMethod: method,
      })
    }
    setError('')
  }
  return (
    <>
      <FadingDialog
        className={styles.dialog}
        aria-labelledby="offer-editor-title"
        onRequestClose={close}
      >
        <header>
          <h3 id="offer-editor-title">
            {initial ? responseTitle : 'Make an Offer'}
          </h3>
          <p>
            {listing.title} ? Asking {offerAmount(listing.price)}
          </p>
          <p>A proposal only. No charge or Order is created.</p>
        </header>
        <div className={styles.editor}>
          <form
            className={workspace.form}
            aria-label="Offer terms"
            id="offer-form"
            onSubmit={(event) => {
              event.preventDefault()
              review()
            }}
          >
            <label className={workspace.field}>
              Offer price (CA$)
              <input
                inputMode="decimal"
                value={price}
                required={true}
                onChange={(event) => setPrice(event.target.value)}
              />
            </label>
            <button
              type="button"
              className={styles.preset}
              onClick={() => setPrice(decimal(listing.price))}
            >
              Asking price · {offerAmount(listing.price)}
            </button>
            <fieldset>
              <legend>Fulfillment</legend>
              <div className={profile.segment}>
                {(['on_campus', 'delivery'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => setMode(value)}
                  >
                    {value === 'on_campus' ? 'On Campus' : 'Delivery'}
                  </button>
                ))}
              </div>
            </fieldset>
            <div className={styles.conditional}>
              {mode === 'on_campus' && (
                <>
                  <label className={workspace.field}>
                    Meetup location
                    <input
                      maxLength={120}
                      value={location}
                      placeholder="e.g. Outside Weldon Library"
                      required={true}
                      onChange={(event) => setLocation(event.target.value)}
                    />
                  </label>
                  <OrderScheduleField
                    value={schedule}
                    now={new Date()}
                    onChange={setSchedule}
                  />
                  <p className={workspace.hint}>
                    Choose a public campus location. Meet, inspect, pay, then
                    handoff.
                  </p>
                </>
              )}
              {mode === 'delivery' && (
                <>
                  <label className={workspace.field}>
                    Delivery fee (CA$)
                    <input
                      inputMode="decimal"
                      value={fee}
                      required={true}
                      onChange={(event) => setFee(event.target.value)}
                    />
                  </label>
                  <fieldset>
                    <legend>Delivery method</legend>
                    <div className={profile.segment}>
                      {(['seller_delivery', 'courier'] as const).map(
                        (value) => (
                          <button
                            type="button"
                            key={value}
                            aria-pressed={method === value}
                            onClick={() => setMethod(value)}
                          >
                            {value === 'courier'
                              ? 'Courier / shipping'
                              : 'Seller delivery'}
                          </button>
                        )
                      )}
                    </div>
                  </fieldset>
                  <p className={workspace.hint}>
                    Agree the Delivery fee now. Delivery address comes later,
                    after acceptance.
                  </p>
                </>
              )}
            </div>
            <label className={workspace.field}>
              {mode === 'delivery'
                ? 'Delivery note / terms (optional)'
                : 'Note (optional)'}
              <textarea
                rows={2}
                maxLength={1000}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
            {error && <p role="alert">{error}</p>}
          </form>
          <aside className={styles.context}>
            <OfferMedia listing={listing} />
            <h4>{listing.title}</h4>
            <p>Asking {offerAmount(listing.price)}</p>
          </aside>
        </div>
        <ActionRow>
          <CardAction variant="red" onClick={close}>
            Cancel
          </CardAction>
          <CardAction variant="green" type="submit" form="offer-form">
            Review Offer
          </CardAction>
        </ActionRow>
      </FadingDialog>
      {confirmation && (
        <FadingDialog
          className={styles.confirm}
          aria-labelledby="offer-confirm-title"
          onRequestClose={() => {
            if (!pending) setConfirmation(null)
          }}
        >
          <h3 id="offer-confirm-title">Review your Offer</h3>
          <p>{listing.title}</p>
          <OfferTermsSummary terms={confirmation} />
          <p>
            Once sent, these terms cannot be edited. A revision creates a new
            Offer{initial ? ' and replaces the current Offer' : ''}.
          </p>
          {error && <p role="alert">{error}</p>}
          <ActionRow>
            <CardAction
              variant="red"
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              Go Back
            </CardAction>
            <CardAction
              variant="green"
              disabled={pending}
              onClick={async () => {
                if (lock.current) return
                lock.current = true
                setPending(true)
                setError('')
                try {
                  await onSend(confirmation)
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : 'Unable to send Offer.'
                  )
                } finally {
                  lock.current = false
                  setPending(false)
                }
              }}
            >
              {pending ? 'Sending…' : action}
            </CardAction>
          </ActionRow>
        </FadingDialog>
      )}
      {discard && (
        <FadingDialog
          className={styles.confirm}
          aria-labelledby="offer-discard-title"
          onRequestClose={() => setDiscard(false)}
        >
          <h3 id="offer-discard-title">Discard Offer changes?</h3>
          <ActionRow>
            <CardAction variant="green" onClick={() => setDiscard(false)}>
              Keep editing
            </CardAction>
            <CardAction variant="red" onClick={onClose}>
              Discard
            </CardAction>
          </ActionRow>
        </FadingDialog>
      )}
    </>
  )
}
