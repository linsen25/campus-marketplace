import { useRef, useState } from 'react'

import success from '@/components/listings/create-success.module.css'
import { StatefulButton } from '@/components/velora/stateful-button'
import type { DeliveryAddress } from '@/lib/order-flow-api'

import workspace from '../listings/listing-workspace.module.css'

import detail from './order-detail-preview.module.css'

export function DeliveryAddressForm({
  initial,
  area,
  onDirty,
  onSave,
  disabled,
}: {
  initial: DeliveryAddress | null
  area: {
    countryCode: 'CA'
    provinceCode: string
    cityLabel: string
    postalPrefix: string
  }
  onDirty: (value: boolean) => void
  onSave: (address: DeliveryAddress) => Promise<void>
  disabled?: boolean
}) {
  const form = useRef<HTMLFormElement>(null)
  const [address, setAddress] = useState<DeliveryAddress>(
    initial || {
      country_code: area.countryCode,
      province_code: area.provinceCode,
      city: area.cityLabel,
      street: '',
      unit: '',
      postal_code: '',
    }
  )
  const fields: Array<[keyof DeliveryAddress, string, number, boolean]> = [
    ['recipient_name', 'Recipient name (optional)', 120, false],
    ['street', 'Street address', 250, true],
    ['unit', 'Unit (optional)', 80, false],
    ['city', 'City', 120, true],
    ['province_code', 'Province / territory', 2, true],
    ['postal_code', 'Postal code', 7, true],
  ]
  return (
    <form
      ref={form}
      className={workspace.form}
      aria-label="Private delivery address"
      onSubmit={(e) => e.preventDefault()}
    >
      <p className={workspace.hint}>
        The address must match {area.cityLabel}, {area.provinceCode} ·{' '}
        {area.postalPrefix}. The Seller can see it only after payment is
        confirmed.
      </p>
      <fieldset className={detail.formGrid} disabled={disabled}>
        {fields.map(([key, label, maxLength, required]) => (
          <label key={key} className={workspace.field}>
            {label}
            <input
              required={required}
              maxLength={maxLength}
              value={address[key] || ''}
              onChange={(e) => {
                setAddress({ ...address, [key]: e.target.value })
                onDirty(true)
              }}
            />
          </label>
        ))}
      </fieldset>
      <StatefulButton
        disabled={disabled}
        className={success.createButton}
        type="submit"
        onClick={(event) => {
          event.preventDefault()
          if (!form.current?.reportValidity()) return undefined
          return onSave(address).then(() => onDirty(false))
        }}
      >
        Save address
      </StatefulButton>
    </form>
  )
}

export function SellerHandoffForm({
  onVerify,
  disabled,
}: {
  onVerify: (code: string) => Promise<void>
  disabled?: boolean
}) {
  const [code, setCode] = useState('')
  const form = useRef<HTMLFormElement>(null)
  return (
    <form
      ref={form}
      className={workspace.form}
      aria-label="Handoff verification"
      onSubmit={(e) => e.preventDefault()}
    >
      <label className={workspace.field}>
        Buyer handoff code
        <input
          required={true}
          disabled={disabled}
          inputMode="numeric"
          autoComplete="off"
          pattern="[0-9]{6}"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value)}
        />
      </label>
      <p className={workspace.hint}>
        Verify the Buyer-held credential at handoff. Verification is performed
        by the server.
      </p>
      <StatefulButton
        disabled={disabled}
        className={success.createButton}
        type="submit"
        onClick={(event) => {
          event.preventDefault()
          return form.current?.reportValidity() ? onVerify(code) : undefined
        }}
      >
        Verify handoff
      </StatefulButton>
    </form>
  )
}

export function CourierShipmentForm({
  onShip,
  disabled,
}: {
  onShip: (carrier: string, tracking: string) => Promise<void>
  disabled?: boolean
}) {
  const [carrier, setCarrier] = useState('')
  const [tracking, setTracking] = useState('')
  const form = useRef<HTMLFormElement>(null)
  return (
    <form
      ref={form}
      className={workspace.form}
      aria-label="Courier shipment"
      onSubmit={(e) => e.preventDefault()}
    >
      <fieldset className={detail.formGrid} disabled={disabled}>
        <label className={workspace.field}>
          Carrier
          <input
            required={true}
            maxLength={120}
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
          />
        </label>
        <label className={workspace.field}>
          Tracking reference
          <input
            required={true}
            maxLength={200}
            value={tracking}
            onChange={(e) => setTracking(e.target.value)}
          />
        </label>
      </fieldset>
      <StatefulButton
        disabled={disabled}
        className={success.createButton}
        type="submit"
        onClick={(event) => {
          event.preventDefault()
          return form.current?.reportValidity()
            ? onShip(carrier, tracking)
            : undefined
        }}
      >
        Confirm Shipped
      </StatefulButton>
      <p className={workspace.hint}>
        Shipment is not proof of receipt. Protection starts after trusted
        delivery or Buyer confirmation.
      </p>
    </form>
  )
}
