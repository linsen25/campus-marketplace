import { ArrowRight, ChevronRight } from 'lucide-react'
import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import successStyles from '@/components/listings/create-success.module.css'
import { ListingMedia } from '@/components/listings/listing-media'
import { MeetingLocationInput } from '@/components/listings/meeting-location-input'
import { ActionRow } from '@/components/ui/action-row'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { StatefulButton } from '@/components/velora/stateful-button'
import { offerAmount, parseOfferAmount } from '@/lib/offer-amount'
import { offerChangedFields } from '@/lib/offer-changes'
import { offerEconomics } from '@/lib/offer-economics'
import {
  combineLocalDateAndTime,
  validateNewOrderSchedule,
} from '@/lib/order-schedule-preview'
import type { ScheduleDraft } from '@/lib/order-schedule-preview'
import type { ChatListing } from '@/types/conversation'
import type { MeetingPlaceReference } from '@/types/meeting-location'
import type { Agreement, Offer, OfferTerms } from '@/types/offer'

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
export function OfferTermsSummary({
  terms,
  showItemOffer = true,
}: {
  terms: OfferTerms
  showItemOffer?: boolean
}) {
  return (
    <dl className={styles.terms}>
      {showItemOffer && (
        <>
          <dt>Item offer</dt>
          <dd>{offerAmount(terms.itemAmountCents)}</dd>
        </>
      )}
      <dt>Fulfillment</dt>
      <dd>{terms.fulfillment === 'on_campus' ? 'Meeting' : 'Delivery'}</dd>
      {terms.fulfillment === 'on_campus' ? (
        <>
          <dt>Meeting location</dt>
          <dd>{terms.meetupLocation}</dd>
          <dt>Meeting date / time</dt>
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
  askingPrice,
  accepted = true,
  showItemPrice = true,
}: {
  terms: OfferTerms
  buyer: boolean
  askingPrice?: number
  accepted?: boolean
  showItemPrice?: boolean
}) {
  const money = offerEconomics(terms)
  return (
    <dl className={styles.terms}>
      {askingPrice !== undefined && (
        <>
          <dt>Original asking price</dt>
          <dd>{offerAmount(askingPrice)}</dd>
        </>
      )}
      {showItemPrice && (
        <>
          <dt>{accepted ? 'Agreed item price' : 'Current Offer price'}</dt>
          <dd>{offerAmount(money.item)}</dd>
        </>
      )}
      {terms.fulfillment === 'delivery' && (
        <>
          <dt>Delivery fee</dt>
          <dd>{offerAmount(money.delivery)}</dd>
        </>
      )}
      <dt>{buyer ? 'Buyer service fee' : 'Seller platform fee'}</dt>
      <dd>{offerAmount(buyer ? money.fee : money.sellerFee)}</dd>
      <dt>{buyer ? 'Total' : 'Seller transaction amount'}</dt>
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
  onAccept,
  onDeny,
  onViewOrder,
  linkedAgreement,
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
  linkedAgreement?: Agreement
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const busy = useRef(false)
  const accepted = useRef(false)
  const commands = useRef<{ accept?: string; deny?: string }>({})
  const own = offer.senderId === viewerId
  const active = offer.status === 'Active' && !blocked && !accepted.current
  const status =
    offer.status === 'Closed' ? 'No longer available' : offer.status
  const direction = offer.senderId === offer.buyerId ? 'Buyer' : 'Seller'
  const fields = offer.changedFields || []
  const invalidAcceptedOrder =
    offer.status === 'Accepted' &&
    linkedAgreement?.id === offer.linkedOrderId &&
    linkedAgreement?.offerId === offer.id &&
    (linkedAgreement.status === 'cancelled' ||
      linkedAgreement.status === 'expired')
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
      if (kind === 'accept') throw failure
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
    <div>
      <div
        className={styles.timelineCard}
        data-offer-own={own}
        data-offer-id={offer.id}
        data-offer-status={status}
      >
        <div className={`${requestStyles.collapsed} ${styles.offerButton}`}>
          <button
            type="button"
            className={styles.offerBody}
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
            </span>
          </button>
          <button
            type="button"
            className={styles.detailArrow}
            data-withdraw-exempt={true}
            aria-label={`View ${direction} Offer details`}
            onClick={() => setOpen(true)}
          >
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <span
          className={`${styles.offerStatus} ${
            ['Active', 'Accepted'].includes(offer.status) &&
            !invalidAcceptedOrder
              ? ''
              : styles.offerStatusClosed
          }`}
        >
          {status}
        </span>
        {open && (
          <FadingDialog
            className={`${styles.dialog} ${styles.detailDialog}`}
            // Focus the mobile dialog itself without scrolling to a bottom action.
            focusAtTop={
              typeof window !== 'undefined' &&
              window.matchMedia('(max-width: 767px)').matches
            }
            aria-labelledby={`offer-${offer.id}`}
            onRequestClose={close}
          >
            <header>
              <h3 id={`offer-${offer.id}`}>Offer · {status}</h3>
              <p>{direction} Offer</p>
            </header>
            <div className={styles.expanded}>
              <OfferMedia listing={listing} />
              <section className={styles.detailInfo}>
                <dl className={styles.primaryOffer}>
                  <dt>Item offer</dt>
                  <dd>{offerAmount(offer.terms.itemAmountCents)}</dd>
                </dl>
                <h4>{listing.title}</h4>
                <OfferTermsSummary terms={offer.terms} showItemOffer={false} />
                <OfferEconomicsSummary
                  terms={offer.terms}
                  buyer={viewerId === offer.buyerId}
                  showItemPrice={false}
                />
                {fields.length > 0 && (
                  <p className={styles.detailChanges}>
                    <strong>Changed terms:</strong>{' '}
                    <span>{fields.join(' · ')}</span>
                  </p>
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
            <ActionRow three={active && !own}>
              <DynamicAction
                variant="red"
                footer={true}
                showArrow={false}
                disabled={pending}
                onClick={close}
              >
                {active && !own ? 'Cancel' : 'Close'}
              </DynamicAction>
              {active && !own && offer.recipientId === viewerId && (
                <>
                  <DynamicAction
                    variant="red"
                    footer={true}
                    showArrow={false}
                    disabled={pending || !onDeny}
                    onClick={() => act('deny')}
                  >
                    Deny
                  </DynamicAction>
                  <span className={successStyles.createAction}>
                    <StatefulButton
                      className={successStyles.createButton}
                      disabled={
                        pending || !active || !offer.canAccept || !onAccept
                      }
                      onClick={() => act('accept')}
                    >
                      <span className={styles.sendLabel}>
                        Confirm
                        <ArrowRight size={16} aria-hidden={true} />
                      </span>
                    </StatefulButton>
                  </span>
                </>
              )}
              {active && own && (
                <>
                  <span className={successStyles.createAction}>
                    <StatefulButton
                      className={successStyles.createButton}
                      disabled={pending || !canEdit}
                      onStateChange={(state) => {
                        if (state === 'success') {
                          setOpen(false)
                          onEdit(offer)
                        }
                      }}
                      onClick={() => Promise.resolve()}
                    >
                      <span className={styles.sendLabel}>
                        Revise Offer
                        <ArrowRight size={16} aria-hidden={true} />
                      </span>
                    </StatefulButton>
                  </span>
                </>
              )}
              {offer.status === 'Accepted' &&
                offer.linkedOrderId &&
                onViewOrder && (
                  <DynamicAction
                    variant="green"
                    footer={true}
                    onClick={() => onViewOrder(offer)}
                  >
                    View Order
                  </DynamicAction>
                )}
            </ActionRow>
          </FadingDialog>
        )}
      </div>
    </div>
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
  const form = useRef<HTMLFormElement>(null)
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
      : listing.live?.meetingLocation?.label ?? ''
  )
  const initialMeeting =
    original?.fulfillment === 'on_campus'
      ? {
          provider: original.meetupLocationProvider,
          placeId: original.meetupPlaceId,
        }
      : listing.live?.meetingLocation
  const [meetingReference, setMeetingReference] =
    useState<MeetingPlaceReference | null>(
      initialMeeting?.provider && initialMeeting.placeId
        ? { provider: 'google', placeId: initialMeeting.placeId }
        : null
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
      : decimal(listing.live?.estimatedDeliveryFeeCents ?? 0)
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
  const completed = useRef(false)
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
    meetingReference,
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
      return false
    }
    if (!mode) {
      setError('Choose Meeting or Delivery.')
      return false
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
        return false
      }
      const scheduled =
        schedule.date && combineLocalDateAndTime(schedule.date, schedule.time)
      if (!scheduled) return false
      setConfirmation({
        ...common,
        fulfillment: 'on_campus',
        meetupLocation: location.trim(),
        ...(meetingReference
          ? {
              meetupLocationProvider: meetingReference.provider,
              meetupPlaceId: meetingReference.placeId,
            }
          : {}),
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
        return false
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
    return true
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
            ref={form}
            className={workspace.form}
            aria-label="Offer terms"
            id="offer-form"
            onSubmit={(event) => {
              event.preventDefault()
              review()
            }}
          >
            <fieldset>
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
                      {value === 'on_campus' ? 'Meeting' : 'Delivery'}
                    </button>
                  ))}
                </div>
              </fieldset>
              <div className={styles.conditional}>
                {mode === 'on_campus' && (
                  <>
                    <MeetingLocationInput
                      label="Meetup location"
                      value={location}
                      required={true}
                      selected={meetingReference}
                      onChange={(value) => {
                        setLocation(value)
                        setMeetingReference(null)
                      }}
                      onSelect={(place) =>
                        setMeetingReference(
                          place
                            ? { provider: 'google', placeId: place.placeId }
                            : null
                        )
                      }
                    />
                    <fieldset className={styles.scheduleGroups}>
                      <OrderScheduleField
                        value={schedule}
                        now={new Date()}
                        onChange={setSchedule}
                      />
                    </fieldset>
                    <p className={workspace.hint}>
                      Choose a public meeting location. Meet, inspect, pay, then
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
                        onChange={(event) =>
                          setPostalPrefix(event.target.value)
                        }
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
            </fieldset>
          </form>
          <aside className={styles.context}>
            <OfferMedia listing={listing} />
            <h4>{listing.title}</h4>
            <p>Asking {offerAmount(askingPrice)}</p>
          </aside>
        </div>
        <ActionRow>
          <DynamicAction
            variant="red"
            footer={true}
            showArrow={false}
            onClick={close}
          >
            Cancel
          </DynamicAction>
          <span className={successStyles.createAction}>
            <StatefulButton
              className={successStyles.createButton}
              type="submit"
              form="offer-form"
              disabled={pending}
              onClick={(event) => {
                event.preventDefault()
                if (!form.current?.reportValidity()) return undefined
                return Promise.resolve().then(() => {
                  if (!review()) throw new Error('Check Offer terms.')
                })
              }}
            >
              <span className={styles.sendLabel}>
                Review Offer
                <ArrowRight size={16} aria-hidden={true} />
              </span>
            </StatefulButton>
          </span>
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
          <OfferEconomicsSummary
            terms={confirmation}
            buyer={buyer}
            askingPrice={initial?.askingPriceCents ?? askingPrice}
            accepted={false}
          />
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
            <DynamicAction
              variant="red"
              footer={true}
              showArrow={false}
              disabled={pending}
              onClick={() => setConfirmation(null)}
            >
              Go Back
            </DynamicAction>
            <span className={successStyles.createAction}>
              <StatefulButton
                className={successStyles.createButton}
                onStateChange={(state) => {
                  if (state === 'success') completed.current = true
                  if (state === 'idle' && completed.current) onClose()
                }}
                onClick={async () => {
                  if (lock.current || completed.current) return
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
                    throw failure
                  } finally {
                    lock.current = false
                    setPending(false)
                  }
                }}
              >
                <span className={styles.sendLabel}>
                  {action}
                  <ArrowRight size={16} aria-hidden={true} />
                </span>
              </StatefulButton>
            </span>
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
