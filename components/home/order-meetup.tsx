import { AnimatePresence } from 'framer-motion'
import { useEffect, useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'
import {
  getEarliestOrderSchedule,
  validateNewOrderSchedule,
  formatScheduleDate,
  formatScheduleTime,
} from '@/lib/order-schedule-preview'
import type { ScheduleDraft } from '@/lib/order-schedule-preview'
import { mutateOrderMeetup } from '@/lib/orders-api'
import type { FormalOrder, MeetupRevision } from '@/types/order'

import workspace from '../listings/listing-workspace.module.css'

import styles from './order-cancellation.module.css'
import detail from './order-detail-preview.module.css'
import { OrderScheduleField } from './order-schedule-field'
import profile from './profile.module.css'

function roleLabel(role: MeetupRevision['proposerRole']) {
  if (role === 'system') return 'System'
  return role === 'buyer' ? 'Buyer' : 'Seller'
}
function timingCopy(now: number, scheduledAt: string, deadline: number) {
  if (now < Date.parse(scheduledAt))
    return 'Meetup confirmed. A replacement requires agreement from both participants.'
  if (now < deadline) return 'Meetup grace period in progress.'
  return 'Meetup grace period ended. Refreshing authoritative Order state.'
}
function ScheduleTerms({ revision }: { revision: MeetupRevision }) {
  const date = new Date(revision.scheduledAt)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes()
  ).padStart(2, '0')}`
  return (
    <dl className={detail.amounts}>
      <dt>Location</dt>
      <dd>{revision.location}</dd>
      <dt>Date</dt>
      <dd>{formatScheduleDate(date)}</dd>
      <dt>Time</dt>
      <dd>{formatScheduleTime(time)}</dd>
      {revision.note && (
        <>
          <dt>Meetup note</dt>
          <dd>{revision.note}</dd>
        </>
      )}
    </dl>
  )
}
export function OrderMeetup({
  order,
  role,
  offset,
  onRefresh,
  onUpdated,
}: {
  order: FormalOrder
  role: 'buyer' | 'seller'
  offset: number
  onRefresh: () => Promise<void>
  onUpdated: (order: FormalOrder, serverTime: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [location, setLocation] = useState('')
  const [note, setNote] = useState('')
  const [schedule, setSchedule] = useState<ScheduleDraft>({
    mode: 'scheduled',
    time: '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [receiptBlocked, setReceiptBlocked] = useState(false)
  const [now, setNow] = useState(Date.now() + offset)
  const lock = useRef(false)
  const command = useRef<{ digest: string; key: string }>()
  useEffect(() => {
    const update = () => setNow(Date.now() + offset)
    update()
    const timer = setInterval(update, 1000)
    return () => clearInterval(timer)
  }, [offset])
  const revisions = order.meetup?.revisions || []
  const current = [...revisions].reverse().find((r) => r.status === 'confirmed')
  const proposal = revisions.find((r) => r.status === 'pending')
  const eligible = Boolean(order.meetup?.mutable && !busy && !receiptBlocked)
  if (!current)
    return <p role="alert">Meetup schedule unavailable. Refresh the Order.</p>
  const deadline = Date.parse(current.scheduledAt) + 60 * 60 * 1000
  let paymentTiming = timingCopy(now, current.scheduledAt, deadline)
  if (order.paymentStatus === 'paid')
    paymentTiming = 'Payment confirmed. No-show expiry does not apply.'
  if (order.paymentStatus === 'processing')
    paymentTiming =
      'Payment processing. Inventory remains held while payment resolves.'
  const start = () => {
    const date = new Date(
      Math.max(
        Date.parse(proposal?.scheduledAt || current.scheduledAt),
        getEarliestOrderSchedule(new Date(now)).getTime()
      )
    )
    setLocation(proposal?.location || current.location)
    setNote(proposal?.note || current.note)
    setSchedule({
      mode: 'scheduled',
      date,
      time: `${String(date.getHours()).padStart(2, '0')}:${String(
        date.getMinutes()
      ).padStart(2, '0')}`,
    })
    setOpen(true)
  }
  const mutate = async (
    action: 'confirm' | 'decline' | 'propose' | 'withdraw'
  ) => {
    if (lock.current || !eligible) return
    const validation = validateNewOrderSchedule(schedule, new Date(now))
    if (action === 'propose' && (!validation.valid || !location.trim())) {
      setError(
        !validation.valid ? validation.message : 'Choose a meetup location.'
      )
      return
    }
    const body =
      action === 'propose' && validation.valid
        ? {
            location: location.trim(),
            note,
            scheduledAt: validation.scheduledAt!.toISOString(),
          }
        : {}
    const revisionId = action === 'propose' ? null : proposal?.id || null
    const digest = JSON.stringify([order.id, action, revisionId, body])
    if (command.current?.digest !== digest)
      command.current = { digest, key: crypto.randomUUID() }
    lock.current = true
    setBusy(true)
    setError('')
    try {
      const result = await mutateOrderMeetup(order.id, action, revisionId, {
        ...body,
        clientActionId: command.current.key,
      })
      setReceiptBlocked(true)
      onUpdated(result.order, result.serverTime)
      setOpen(false)
      window.dispatchEvent(new Event('marketplace-orders-changed'))
      await onRefresh()
      setReceiptBlocked(false)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Unable to update meetup. Refresh and retry.'
      )
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  return (
    <section
      className={profile.panel}
      aria-label="Meetup"
      data-order-meetup={order.id}
    >
      <h4>Meetup</h4>
      <h5>Current confirmed meetup</h5>
      <p>Confirmed</p>
      <ScheduleTerms revision={current} />
      {order.lifecycle === 'expired' ? (
        <p>Meetup was not completed within the allowed grace period.</p>
      ) : (
        order.lifecycle === 'open' && <p>{paymentTiming}</p>
      )}
      {proposal && (
        <section
          aria-label="Proposed new meetup"
          data-meetup-proposal={proposal.id}
        >
          <h5>
            {proposal.proposerRole === role
              ? 'Awaiting confirmation'
              : 'New meetup proposed'}
          </h5>
          <p>
            The current confirmed meetup remains authoritative until
            confirmation.
          </p>
          <ScheduleTerms revision={proposal} />
          {eligible && (
            <ActionRow>
              {proposal.proposerRole === role ? (
                <CardAction variant="red" onClick={() => mutate('withdraw')}>
                  Withdraw proposal
                </CardAction>
              ) : (
                <>
                  <CardAction variant="green" onClick={() => mutate('confirm')}>
                    Confirm new meetup
                  </CardAction>
                  <CardAction variant="red" onClick={() => mutate('decline')}>
                    Decline
                  </CardAction>
                </>
              )}
            </ActionRow>
          )}
        </section>
      )}
      {eligible && (
        <CardAction variant="green" onClick={start}>
          Propose new meetup
        </CardAction>
      )}
      {error && (
        <div role="alert">
          <p>{error}</p>
          <CardAction
            onClick={async () => {
              try {
                await onRefresh()
                setReceiptBlocked(false)
                setError('')
              } catch {
                setError('Unable to refresh. Please retry.')
              }
            }}
          >
            Refresh meetup
          </CardAction>
        </div>
      )}
      <details>
        <summary>Meetup history</summary>
        {revisions.map((r) => (
          <article key={r.id}>
            <h5>
              {r.revision === 0
                ? 'Initial confirmed meetup'
                : `Proposal ${r.revision} ? ${r.status}`}
            </h5>
            <ScheduleTerms revision={r} />
            {r.revision > 0 && (
              <p>
                Proposed by {r.proposerRole === 'buyer' ? 'Buyer' : 'Seller'} ?{' '}
                {new Date(r.proposedAt).toLocaleString()}
              </p>
            )}
            {r.decidedAt && (
              <p>
                {r.status} ? {roleLabel(r.deciderRole)} ?{' '}
                {new Date(r.decidedAt).toLocaleString()}
              </p>
            )}
          </article>
        ))}
      </details>
      <AnimatePresence>
        {open && (
          <FadingDialog
            className={`${workspace.confirmation} ${styles.dialog}`}
            aria-labelledby="meetup-proposal-title"
            onRequestClose={() => {
              if (!lock.current) setOpen(false)
            }}
          >
            <h3 id="meetup-proposal-title">Propose new meetup</h3>
            <p>
              This proposal changes the meetup only after the other participant
              confirms.
            </p>
            <fieldset disabled={busy}>
              <label className={workspace.field}>
                Meetup location
                <input
                  value={location}
                  maxLength={120}
                  onChange={(e) => setLocation(e.target.value)}
                />
              </label>
              <OrderScheduleField
                value={schedule}
                now={new Date(now)}
                onChange={setSchedule}
              />
              <label className={workspace.field}>
                Meetup note (optional)
                <textarea
                  value={note}
                  maxLength={1000}
                  rows={3}
                  onChange={(e) => setNote(e.target.value)}
                />
              </label>
            </fieldset>
            {error && <p role="alert">{error}</p>}
            <ActionRow>
              <CardAction
                variant="red"
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Cancel
              </CardAction>
              <CardAction
                variant="green"
                disabled={busy}
                onClick={() => mutate('propose')}
              >
                {busy ? 'Sending?' : 'Send proposal'}
              </CardAction>
            </ActionRow>
          </FadingDialog>
        )}
      </AnimatePresence>
    </section>
  )
}
