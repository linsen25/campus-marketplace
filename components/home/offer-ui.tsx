import { ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ListingMedia } from '@/components/listings/listing-media'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { offerAmount, parseOfferAmount } from '@/lib/offer-amount'
import { offerChangedFields } from '@/lib/offer-changes'
import { offerEconomics } from '@/lib/offer-economics'
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
import { WithdrawContext, useWithdrawalEligibility } from './withdraw-context'

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
          {terms.deliveryArea && (
            <>
              <dt>Delivery area</dt>
              <dd>
                {terms.deliveryArea.cityLabel},{' '}
                {terms.deliveryArea.provinceCode} ·{' '}
                {terms.deliveryArea.postalPrefix}
              </dd>
            </>
          )}
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
export function OfferEconomicsSummary({
  terms,
  buyer,
}: {
  terms: OfferTerms
  buyer: boolean
}) {
  const money = offerEconomics(terms)
  return (
    <dl className={styles.terms}>
      <dt>Item price</dt>
      <dd>{offerAmount(money.item)}</dd>
      {terms.fulfillment === 'delivery' && (
        <>
          <dt>Delivery fee</dt>
          <dd>{offerAmount(money.delivery)}</dd>
        </>
      )}
      <dt>{buyer ? 'Buyer service fee' : 'Seller platform fee'}</dt>
      <dd>{offerAmount(buyer ? money.fee : money.sellerFee)}</dd>
      <dt>{buyer ? 'Buyer total' : 'Seller transaction amount'}</dt>
      <dd>{offerAmount(buyer ? money.total : money.sellerGross)}</dd>
    </dl>
  )
}
// eslint-disable-next-line complexity -- Recipient/owner lifecycle controls share the existing dialog and one async action guard.
export function OfferCard({
  offer,
  listing,
  viewerId,
  participantName,
  blocked,
  canEdit,
  onEdit,
  onWithdraw,
  onAccept,
  onDeny,
  onViewOrder,
}: {
  offer: Offer
  listing: ChatListing
  viewerId: string
  participantName: string
  blocked: boolean
  canEdit: boolean
  onEdit: (offer: Offer) => void
  onWithdraw: (offer: Offer) => Promise<void>
  onAccept?: (offer: Offer, command: string) => Promise<void>
  onDeny?: (offer: Offer, command: string) => Promise<void>
  onViewOrder?: (offer: Offer) => void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const accepted = useRef(false)
  const commands = useRef<{ accept?: string; deny?: string }>({})
  const own = offer.senderId === viewerId
  const canWithdraw = useWithdrawalEligibility(
    offer.createdAt,
    own && offer.canWithdraw && !blocked
  )
  const active = offer.status === 'Active' && !blocked && !accepted.current
  const status =
    offer.status === 'Closed' ? 'No longer available' : offer.status
  const direction = offer.senderId === offer.buyerId ? 'Buyer' : 'Seller'
  const fields = offer.changedFields || []
  const close = () => {
    if (!pending) setOpen(false)
  }
  const act = async (kind: 'accept' | 'deny') => {
    if (busy.current || !active || own || offer.recipientId !== viewerId) return
    if (kind === 'accept' && !offer.canAccept) return
    const action = kind === 'accept' ? onAccept : onDeny
    if (!action) return
    busy.current = true
    setPending(true)
    setError('')
    try {
      if (!commands.current[kind]) commands.current[kind] = crypto.randomUUID()
      const command = commands.current[kind] as string
      await action(offer, command)
      if (kind === 'accept') accepted.current = true
      setOpen(false)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to update Offer. Refresh and retry.'
      )
    } finally {
      busy.current = false
      setPending(false)
    }
  }
  if (offer.status === 'Withdrawn')
    return (
      <small className={styles.tombstone}>
        {own ? 'You' : participantName} withdrew an offer.
      </small>
    )
  return (
    <WithdrawContext
      enabled={canWithdraw}
      createdAt={offer.createdAt}
      onWithdraw={() => onWithdraw(offer)}
    >
      <div
        className={styles.timelineCard}
        data-offer-id={offer.id}
        data-offer-status={status}
      >
        <button
          type="button"
          className={`${requestStyles.collapsed} ${
            offer.status !== 'Active' ? styles.terminal : ''
          }`}
          aria-label={`Open ${direction} Offer: ${status}`}
          onClick={() => setOpen(true)}
        >
          <span>
            <small>
              {direction} ·{' '}
              {offer.mutationKind === 'counter' ? 'Counter Offer' : 'Offer'}
            </small>
            <strong>{offerAmount(offer.terms.itemAmountCents)}</strong>
            {fields.length > 0 && (
              <small>
                Changed: {fields.slice(0, 3).join(' · ')}
                {fields.length > 3 ? ` · +${fields.length - 3} more` : ''}
              </small>
            )}
            <span className={requestStyles.status}>{status}</span>
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
              <h3 id={`offer-${offer.id}`}>Offer · {status}</h3>
              <p>{direction} Offer</p>
            </header>
            <div className={styles.expanded}>
              <OfferMedia listing={listing} />
              <section>
                <h4>{listing.title}</h4>
                <OfferTermsSummary terms={offer.terms} />
                <OfferEconomicsSummary
                  terms={offer.terms}
                  buyer={viewerId === offer.buyerId}
                />
                {fields.length > 0 && (
                  <p>Changed terms: {fields.join(' · ')}</p>
                )}
                <p className={workspace.hint}>
                  {offerExplanation(offer.status)}
                </p>
              </section>
            </div>
            {error && <p role="alert">{error}</p>}
            {offer.acceptBlockReason && active && (
              <p>
                This Offer is not currently executable. Refresh and review the
                Listing.
              </p>
            )}
            <ActionRow three={active && (!own || canWithdraw)}>
              <CardAction variant="red" disabled={pending} onClick={close}>
                {active && !own ? 'Cancel' : 'Close'}
              </CardAction>
              {active && !own && offer.recipientId === viewerId && (
                <>
                  <CardAction
                    variant="red"
                    disabled={pending || !onDeny}
                    onClick={() => act('deny')}
                  >
                    Deny
                  </CardAction>
                  <CardAction
                    variant="green"
                    disabled={pending || !offer.canAccept || !onAccept}
                    onClick={() => act('accept')}
                  >
                    {pending ? 'Working…' : 'Confirm'}
                  </CardAction>
                </>
              )}
              {active && own && (
                <>
                  <CardAction
                    variant="green"
                    disabled={pending || !canEdit}
                    onClick={() => {
                      setOpen(false)
                      onEdit(offer)
                    }}
                  >
                    Revise Offer
                  </CardAction>
                  {canWithdraw && (
                    <CardAction
                      variant="red"
                      disabled={pending}
                      onClick={async () => {
                        if (busy.current) return
                        busy.current = true
                        setPending(true)
                        setError('')
                        try {
                          await onWithdraw(offer)
                          setOpen(false)
                        } catch (failure) {
                          setError(
                            failure instanceof Error
                              ? failure.message
                              : 'Unable to withdraw Offer.'
                          )
                        } finally {
                          busy.current = false
                          setPending(false)
                        }
                      }}
                    >
                      Withdraw
                    </CardAction>
                  )}
                </>
              )}
              {offer.status === 'Accepted' &&
                offer.linkedOrderId &&
                onViewOrder && (
                  <CardAction
                    variant="green"
                    onClick={() => onViewOrder(offer)}
                  >
                    View Order
                  </CardAction>
                )}
            </ActionRow>
          </FadingDialog>
        )}
      </div>
    </WithdrawContext>
  )
}
// eslint-disable-next-line complexity -- Two discriminated fulfillment drafts retain independent values and share one confirmation flow.
export function OfferEditor({
  listing,
  initial,
  viewerId,
  buyer = true,
  newRound = false,
  onClose,
  onSend,
}: {
  listing: ChatListing
  initial?: Offer
  viewerId: string
  buyer?: boolean
  newRound?: boolean
  onClose: () => void
  onSend: (terms: OfferTerms) => Promise<void>
}) {
  const original = initial?.terms
  const askingPrice = listing.live?.price ?? listing.price
  const [price, setPrice] = useState(
    decimal(original?.itemAmountCents ?? askingPrice)
  )
  const [mode, setMode] = useState<'delivery' | 'on_campus' | null>(
    original?.fulfillment ??
      (listing.live?.preferredFulfillment === 'DELIVERY'
        ? 'delivery'
        : 'on_campus')
  )
  const [location, setLocation] = useState(
    original?.fulfillment === 'on_campus'
      ? original.meetupLocation
      : listing.live?.pickupArea ?? ''
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
  const originalArea =
    original?.fulfillment === 'delivery' ? original.deliveryArea : undefined
  const [province, setProvince] = useState(originalArea?.provinceCode ?? 'ON')
  const [city, setCity] = useState(originalArea?.cityLabel ?? '')
  const [postalPrefix, setPostalPrefix] = useState(
    originalArea?.postalPrefix ?? ''
  )
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
    province,
    city,
    postalPrefix,
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
  let editorTitle = newRound ? 'Make a New Offer' : 'Make an Offer'
  if (initial) editorTitle = responseTitle
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
        !city.trim() ||
        !/^[ABCEGHJKLMNPRSTVXY][0-9][ABCEGHJKLMNPRSTVWXYZ]$/.test(
          postalPrefix.toUpperCase().replace(/\s/g, '')
        ) ||
        !Number.isSafeInteger(amount + deliveryFee)
      ) {
        setError(
          'Enter the Delivery fee, method and Canadian destination city/postal prefix.'
        )
        return
      }
      setConfirmation({
        ...common,
        fulfillment: 'delivery',
        deliveryFeeCents: deliveryFee,
        deliveryMethod: method,
        deliveryArea: {
          countryCode: 'CA',
          provinceCode: province,
          cityLabel: city.trim(),
          postalPrefix: postalPrefix.toUpperCase().replace(/\s/g, ''),
        },
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
          <h3 id="offer-editor-title">{editorTitle}</h3>
          <p>
            {listing.title} · Asking {offerAmount(askingPrice)}
          </p>
          <p>This is only a proposal. No charge or Order is created yet.</p>
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
            <fieldset>
              <legend>Fulfillment</legend>
              <div className={profile.segment}>
                {(['on_campus', 'delivery'] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value)
                      setError('')
                    }}
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
                  <label className={workspace.field}>
                    Province / territory
                    {/* eslint-disable-next-line jsx-a11y/no-onchange -- Controlled province selection does not navigate or move focus. */}
                    <select
                      value={province}
                      onChange={(event) => setProvince(event.target.value)}
                    >
                      {[
                        'AB',
                        'BC',
                        'MB',
                        'NB',
                        'NL',
                        'NS',
                        'NT',
                        'NU',
                        'ON',
                        'PE',
                        'QC',
                        'SK',
                        'YT',
                      ].map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label className={workspace.field}>
                    Delivery city
                    <input
                      value={city}
                      maxLength={120}
                      required={true}
                      onChange={(event) => setCity(event.target.value)}
                    />
                  </label>
                  <label className={workspace.field}>
                    Postal prefix (first 3 characters)
                    <input
                      value={postalPrefix}
                      maxLength={4}
                      required={true}
                      placeholder="e.g. N6A"
                      onChange={(event) => setPostalPrefix(event.target.value)}
                    />
                  </label>
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
            <p>Asking {offerAmount(askingPrice)}</p>
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
          <OfferEconomicsSummary terms={confirmation} buyer={buyer} />
          <p>
            Changed terms:{' '}
            {offerChangedFields(
              confirmation,
              original ?? {
                itemAmountCents: askingPrice,
                fulfillment:
                  listing.live?.preferredFulfillment === 'DELIVERY'
                    ? 'delivery'
                    : 'on_campus',
              }
            ).join(' · ') || 'None'}
          </p>
          <p>
            Once sent, these terms cannot be edited. A revision creates a new
            Offer
            {initial?.senderId === viewerId
              ? ' and replaces your current Offer'
              : ''}
            .
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
          <h3 id="offer-discard-title">Discard offer changes?</h3>
          <ActionRow>
            <CardAction variant="red" onClick={onClose}>
              Discard
            </CardAction>
            <CardAction variant="green" onClick={() => setDiscard(false)}>
              Keep editing
            </CardAction>
          </ActionRow>
        </FadingDialog>
      )}
    </>
  )
}
