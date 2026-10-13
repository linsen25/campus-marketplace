import { useRef, useState } from 'react'

import { CardAction } from '@/components/listings/card-actions'
import { ActionRow } from '@/components/ui/action-row'
import { FadingDialog } from '@/components/ui/fading-dialog'
import { StatefulButton } from '@/components/velora/stateful-button'
import { validPreviewAddress } from '@/lib/order-interaction-preview'
import type {
  PreviewAddress,
  PreviewRole,
} from '@/lib/order-interaction-preview'

import workspace from '../listings/listing-workspace.module.css'

import styles from './order-detail-preview.module.css'
import profile from './profile.module.css'

export function PreviewAddressForm({
  initial,
  onSave,
}: {
  initial?: PreviewAddress
  onSave: (address: PreviewAddress) => void
}) {
  const [address, setAddress] = useState<PreviewAddress>(
    initial || {
      recipient: '',
      address: '',
      unit: '',
      city: '',
      province: '',
      postal: '',
    }
  )
  const valid = validPreviewAddress(address)
  const fields: Array<[keyof PreviewAddress, string]> = [
    ['recipient', 'Recipient name'],
    ['address', 'Address'],
    ['unit', 'Apartment / Unit (optional)'],
    ['city', 'City'],
    ['province', 'Province'],
    ['postal', 'Postal code'],
  ]
  return (
    <form
      className={workspace.form}
      autoComplete="off"
      aria-label="Preview shipping address"
      onSubmit={(event) => {
        event.preventDefault()
        if (valid)
          onSave({ ...address, postal: address.postal.trim().toUpperCase() })
      }}
    >
      <p className={workspace.hint}>
        Synthetic details only · Stored in this preview session, never sent.
        Seller cannot view this address before simulated payment.
      </p>
      <fieldset className={styles.formGrid}>
        {fields.map(([key, label]) => (
          <label key={key} className={workspace.field}>
            {label}
            <input
              maxLength={160}
              required={key !== 'unit'}
              value={address[key]}
              onChange={(event) =>
                setAddress({ ...address, [key]: event.target.value })
              }
            />
          </label>
        ))}
      </fieldset>
      {!valid && (
        <p className={workspace.hint}>
          Complete the required fields and enter a Canadian postal code.
        </p>
      )}
      <CardAction variant="blue" type="submit" disabled={!valid}>
        Save &amp; Continue
      </CardAction>
    </form>
  )
}
export function PreviewShipmentForm({
  onSave,
}: {
  onSave: (carrier: string, tracking: string) => void
}) {
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  return (
    <form
      className={workspace.form}
      aria-label="Preview shipment details"
      onSubmit={(event) => {
        event.preventDefault()
        if (carrier.trim() && tracking.trim()) onSave(carrier, tracking)
      }}
    >
      <fieldset className={styles.formGrid}>
        <label className={workspace.field}>
          Carrier
          <input
            required={true}
            maxLength={100}
            value={carrier}
            onChange={(event) => setCarrier(event.target.value)}
          />
        </label>
        <label className={workspace.field}>
          Tracking number
          <input
            required={true}
            maxLength={100}
            value={tracking}
            onChange={(event) => setTracking(event.target.value)}
          />
        </label>
      </fieldset>
      <StatefulButton
        className={styles.stateful}
        type="submit"
        disabled={!carrier.trim() || !tracking.trim()}
      >
        Confirm Shipped
      </StatefulButton>
      <p className={workspace.hint}>
        Local preview only · No carrier or shipping service is contacted.
      </p>
    </form>
  )
}
export function PreviewCodeForm({
  code,
  onConfirm,
}: {
  code?: string
  onConfirm: (value: string) => void
}) {
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  return (
    <form
      className={workspace.form}
      aria-label="Preview handoff verification"
      onSubmit={(event) => {
        event.preventDefault()
        if (!code || value !== code) {
          setError('That preview handoff code does not match.')
          return
        }
        onConfirm(value)
      }}
    >
      <label className={workspace.field}>
        Enter Handoff Code
        <input
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required={true}
          value={value}
          onChange={(event) => {
            setValue(event.target.value.replace(/\D/g, ''))
            setError('')
          }}
        />
      </label>
      {error && (
        <p role="alert" className={profile.error}>
          {error}
        </p>
      )}
      <StatefulButton
        className={styles.stateful}
        type="submit"
        disabled={value.length !== 6}
      >
        Verify Handoff Code
      </StatefulButton>
    </form>
  )
}
const buyerIssueReasons = [
  "Seller didn't show up",
  'Seller refused to provide the item',
  'Item is significantly different from the listing',
  'Item has an undisclosed problem',
  'Payment issue',
  'Safety concern',
  'Other',
]
const sellerIssueReasons = [
  "Buyer didn't show up",
  'Buyer stopped responding',
  'Buyer refused the handoff',
  'Safety concern',
  'Other',
]
export function PreviewReasonDialog({
  role,
  onClose,
  onConfirm,
}: {
  role: PreviewRole
  onClose: () => void
  onConfirm: (reason: string, detail: string) => void
}) {
  const reasons = role === 'buyer' ? buyerIssueReasons : sellerIssueReasons
  const [reason, setReason] = useState(reasons[0])
  const [detail, setDetail] = useState('')
  const label = 'Report issue \u00b7 Preview only'
  return (
    <FadingDialog
      className={`${workspace.confirmation} ${styles.dialog}`}
      aria-label="Report an issue"
      onRequestClose={onClose}
    >
      <h3>Report an issue</h3>
      <label className={workspace.field}>
        Reason
        {/* eslint-disable-next-line jsx-a11y/no-onchange -- Changes local conditional fields only; preserves focus. */}
        <select
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          {reasons.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      {reason === 'Other' && (
        <label className={workspace.field}>
          Details
          <textarea
            rows={3}
            maxLength={1000}
            value={detail}
            onChange={(event) => setDetail(event.target.value)}
          />
        </label>
      )}
      <p className={workspace.hint}>
        Preview only · No report, cancellation, refund or payment operation is
        sent.
      </p>
      <ActionRow>
        <CardAction
          className={workspace.neutralButton}
          surfaceClassName={workspace.neutralSurface}
          onClick={onClose}
        >
          Go Back
        </CardAction>
        <CardAction
          variant="blue"
          disabled={reason === 'Other' && !detail.trim()}
          onClick={() => onConfirm(reason, detail)}
        >
          {label}
        </CardAction>
      </ActionRow>
    </FadingDialog>
  )
}
const requestCancelReasons = [
  'Incorrect transaction details',
  'Item is no longer available',
  'Cannot complete the transaction',
  'Sent by mistake',
  'Other',
]
const buyerCancelReasons = [
  'Changed my mind',
  'Cannot complete payment',
  'Cannot meet at the agreed time',
  'Other',
]
const sellerCancelReasons = [
  'Item is no longer available',
  'Item was damaged / cannot be sold',
  'Cannot meet at the agreed time',
  'Incorrect transaction terms',
  'Other',
]
export function PreviewCancellationDialog({
  kind,
  role,
  onClose,
  onConfirm,
  formal = false,
}: {
  kind: 'order' | 'request'
  role: PreviewRole
  onClose: () => void
  onConfirm: (reason: string, note: string) => Promise<void> | void
  formal?: boolean
}) {
  const [reason, setReason] = useState('')
  const [note, setNote] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const action = useRef(false)
  let reasons = role === 'buyer' ? buyerCancelReasons : sellerCancelReasons
  if (kind === 'request') reasons = requestCancelReasons
  const title =
    kind === 'request' ? 'Cancel Order Request?' : 'Cancel this Order?'
  return (
    <FadingDialog
      className={`${workspace.confirmation} ${styles.dialog}`}
      aria-label={title}
      onRequestClose={onClose}
    >
      <h3>{title}</h3>
      <p>
        {kind === 'request'
          ? 'The buyer will no longer be able to accept this request. The request will remain visible in the conversation.'
          : 'This will end the reservation and make the listing available again. No payment has been completed.'}
      </p>
      {kind === 'order' && role === 'seller' && (
        <p>
          The buyer will no longer be able to complete payment for this Order.
        </p>
      )}
      <label className={workspace.field}>
        Reason
        {/* eslint-disable-next-line jsx-a11y/no-onchange -- Local cancellation draft only. */}
        <select
          aria-label="Reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
        >
          <option value="">Choose a reason</option>
          {reasons.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      </label>
      <label className={workspace.field}>
        Additional note (optional)
        <textarea
          maxLength={1000}
          value={note}
          onChange={(event) => setNote(event.target.value)}
        />
      </label>
      <ActionRow>
        <CardAction
          className={workspace.neutralButton}
          surfaceClassName={workspace.neutralSurface}
          onClick={onClose}
        >
          {kind === 'request' ? 'Keep Request' : 'Keep Order'}
        </CardAction>
        <CardAction
          variant="blue"
          disabled={!reason || pending}
          aria-busy={pending}
          onClick={async () => {
            if (!reason || action.current) return
            action.current = true
            setPending(true)
            setError('')
            try {
              await onConfirm(reason, note)
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : 'Unable to cancel. Please retry.'
              )
            } finally {
              action.current = false
              setPending(false)
            }
          }}
        >
          {kind === 'request' ? 'Cancel Request' : 'Cancel Order'}
        </CardAction>
      </ActionRow>
      {error && (
        <p role="alert" className={profile.error}>
          {error}
        </p>
      )}
      {!formal && (
        <p className={workspace.hint}>
          Local preview only �� No payment, refund or backend operation.
        </p>
      )}
    </FadingDialog>
  )
}
