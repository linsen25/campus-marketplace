import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import type { ReactNode } from 'react'
import { useEffect, useRef, useState } from 'react'

import FilterInteraction from '@/components/filter-interaction'
import { DynamicAction } from '@/components/ui/dynamic-action'
import { Skeleton } from '@/components/ui/skeleton'
import { billingCountryOptions } from '@/lib/billing-countries'
import { marketplaceRequest } from '@/lib/listings-api'
import { getStripeClient, stripeClientAvailable } from '@/lib/stripe-client'

import css from './financial-settings.module.css'
import profile from './profile.module.css'

export const stripeSetupAvailable = stripeClientAvailable
type Prepared = {
  clientSecret: string
  publishableKey: string
  returnUrl: string
}
type PaymentMode = 'change' | 'setup'
const saveLabels: Record<PaymentMode, string> = {
  change: 'Save changes',
  setup: 'Save payment method',
}
function PaymentLoading({ error = '' }: { error?: string }) {
  return (
    <div className={css.elementLoading} role="status" aria-busy={!error}>
      <span className={css.loadingAnnouncement}>
        {error
          ? 'Secure card form unavailable.'
          : 'Preparing secure payment setup…'}
      </span>
      {!error && (
        <div className={css.paymentSkeleton} aria-hidden="true">
          <Skeleton className={css.skeletonHeader} />
          <div className={css.skeletonField}>
            <Skeleton className={css.skeletonLabel} />
            <Skeleton className={css.skeletonInput} />
          </div>
          <div className={css.skeletonColumns}>
            {[0, 1].map((key) => (
              <div className={css.skeletonField} key={key}>
                <Skeleton className={css.skeletonLabel} />
                <Skeleton className={css.skeletonInput} />
              </div>
            ))}
          </div>
          <div className={css.skeletonField}>
            <Skeleton className={css.skeletonLabel} />
            <Skeleton className={css.skeletonInput} />
          </div>
          <div className={css.skeletonField}>
            <Skeleton className={css.skeletonLegal} />
            <Skeleton className={css.skeletonLegal} />
          </div>
        </div>
      )}
    </div>
  )
}
function CardElement({
  mode,
  prepared,
  onCancel,
  onComplete,
}: {
  mode: PaymentMode
  prepared: Prepared
  onCancel: () => void
  onComplete: () => Promise<void>
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [ready, setReady] = useState(false)
  const [complete, setComplete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [country, setCountry] = useState('CA')
  const [countryOpen, setCountryOpen] = useState(false)
  const countryAnchor = useRef<HTMLDivElement>(null)
  const [countryPortal, setCountryPortal] = useState<HTMLElement | null>(null)
  useEffect(() => {
    setCountryPortal(countryAnchor.current?.closest('dialog') || null)
  }, [])
  const locked = useRef(false)
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const handleSave = async () => {
    if (locked.current || !stripe || !elements) return
    locked.current = true
    setBusy(true)
    setError('')
    try {
      if (!checking) {
        const validation = await elements.submit()
        if (!mounted.current) return
        if (validation.error) {
          setError('Review your card details and try again.')
          return
        }
        const result = await stripe.confirmSetup({
          elements,
          redirect: 'if_required',
          confirmParams: {
            return_url: prepared.returnUrl,
            payment_method_data: { billing_details: { address: { country } } },
          },
        })
        if (!mounted.current) return
        if (result.error) {
          setError(
            'Unable to confirm this card. Review your details or check its status before retrying.'
          )
          setChecking(true)
          return
        }
      }
      const result = await marketplaceRequest<{
        setupStatus: string
        capabilities: { paymentMethod: { status: string } }
      }>('/api/stripe/reconcile', 'POST', { kind: 'payment_method' })
      if (!mounted.current) return
      if (
        result.setupStatus === 'succeeded' &&
        result.capabilities.paymentMethod.status === 'set'
      )
        await onComplete()
      else {
        setChecking(['processing', 'succeeded'].includes(result.setupStatus))
        setError(
          result.setupStatus === 'processing'
            ? 'Your card setup is still being confirmed. Check its status shortly.'
            : 'Card setup is not complete. Review the card details and try again.'
        )
      }
    } catch {
      if (mounted.current) {
        setChecking(true)
        setError('Unable to confirm setup status. Check again before retrying.')
      }
    } finally {
      locked.current = false
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <>
      <div className={css.paymentBody} data-payment-body="true">
        <div
          id="stripe-payment-element-host"
          className={css.elementHost}
          aria-busy={!ready}
        >
          {!ready && <PaymentLoading error={error} />}
          <PaymentElement
            options={{
              layout: { type: 'accordion', radios: 'never' },
              wallets: { applePay: 'never', googlePay: 'never', link: 'never' },
              fields: { billingDetails: { address: { country: 'never' } } },
              defaultValues: { billingDetails: { address: { country } } },
            }}
            onReady={() => setReady(true)}
            onChange={(event) => setComplete(event.complete)}
            onLoadError={() =>
              setError(
                'Unable to load the secure card form. Close and try again.'
              )
            }
          />
          <div ref={countryAnchor} className={css.paymentCountry}>
            <p>Country or region</p>
            <FilterInteraction
              label="Country or region"
              appearance="select"
              options={billingCountryOptions}
              value={country}
              isOpen={countryOpen}
              portalContainer={countryPortal}
              disabled={!ready || busy}
              onChange={setCountry}
              onOpenChange={setCountryOpen}
            />
          </div>
        </div>
        <p className={profile.caption}>
          Save this card for future UU purchases.
        </p>
        {error && (
          <p className={profile.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={css.actions}>
        <DynamicAction
          variant="red"
          showArrow={false}
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </DynamicAction>
        <DynamicAction
          variant="green"
          disabled={busy || !stripe || !ready || (!complete && !checking)}
          onClick={handleSave}
        >
          {checking ? 'Check status' : saveLabels[mode]}
        </DynamicAction>
      </div>
    </>
  )
}
export function StripeCardSetup({
  mode = 'setup',
  preview,
  onCancel,
  onComplete,
}: {
  mode?: PaymentMode
  preview: ReactNode
  onCancel: () => void
  onComplete: () => Promise<void>
}) {
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (!stripeSetupAvailable()) return undefined
    let active = true
    setError('')
    marketplaceRequest<Prepared>('/api/stripe/card-setup', 'POST', {})
      .then(async (result) => {
        const stripe = await getStripeClient(result.publishableKey)
        if (!stripe) throw new Error('Secure card setup unavailable')
        if (active) setPrepared(result)
      })
      .catch(() => {
        if (active) setError('Unable to start payment setup. Please try again.')
      })
    return () => {
      active = false
    }
  }, [retry])
  if (prepared)
    return (
      <Elements
        stripe={getStripeClient(prepared.publishableKey)}
        options={{
          clientSecret: prepared.clientSecret,
          appearance: {
            theme: 'night',
            variables: {
              colorPrimary: '#b995dc',
              colorBackground: '#1a1222',
              colorText: '#f3edf8',
              colorDanger: '#f2a0ad',
              borderRadius: '12px',
              spacingUnit: '4px',
            },
          },
        }}
      >
        <CardElement
          mode={mode}
          prepared={prepared}
          onCancel={onCancel}
          onComplete={onComplete}
        />
      </Elements>
    )
  return (
    <>
      <div className={css.paymentBody} data-payment-body="true">
        <div
          id="stripe-payment-element-host"
          className={css.elementHost}
          aria-label="Secure card setup"
        >
          {stripeSetupAvailable() ? <PaymentLoading error={error} /> : preview}
        </div>
        {stripeSetupAvailable() && (
          <p className={profile.caption}>
            Save this card for future UU purchases.
          </p>
        )}
        {error && (
          <p className={profile.error} role="alert">
            {error}
          </p>
        )}
      </div>
      <div className={css.actions}>
        <DynamicAction variant="red" showArrow={false} onClick={onCancel}>
          Cancel
        </DynamicAction>
        <DynamicAction
          variant="green"
          disabled={!error}
          onClick={() => setRetry((value) => value + 1)}
        >
          {error ? 'Retry setup' : saveLabels[mode]}
        </DynamicAction>
      </div>
    </>
  )
}
