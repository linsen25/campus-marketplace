import {
  Elements,
  PaymentElement,
  useElements,
  useStripe,
} from '@stripe/react-stripe-js'
import { useEffect, useRef, useState } from 'react'

import { getStripeClient } from '@/lib/stripe-client'

type Confirmation = { clientSecret: string; paymentIntentId: string }

function PaymentForm({
  onComplete,
  onCancel,
}: {
  onComplete: () => Promise<void>
  onCancel: () => void
}) {
  const stripe = useStripe()
  const elements = useElements()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [ready, setReady] = useState(false)
  const mounted = useRef(true)
  useEffect(
    () => () => {
      mounted.current = false
    },
    []
  )
  const submit = async () => {
    if (!stripe || !elements || busy) return
    setBusy(true)
    setError('')
    try {
      const validation = await elements.submit()
      if (validation.error) throw new Error('Review your payment details.')
      // Stripe.js is not Order payment evidence; the server reconciles the
      // bound PaymentIntent from the signed webhook before displaying Paid.
      const result = await stripe.confirmPayment({
        elements,
        redirect: 'if_required',
        confirmParams: { return_url: `${window.location.origin}/home` },
      })
      if (result.error)
        throw new Error(
          'Payment could not be confirmed. Check the details and retry.'
        )
      if (!result.paymentIntent || result.paymentIntent.status !== 'succeeded')
        throw new Error(
          'Payment is still being confirmed. Refresh the Order before retrying.'
        )
      await onComplete()
    } catch (e) {
      if (mounted.current)
        setError(e instanceof Error ? e.message : 'Payment failed. Retry.')
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return (
    <div>
      <div aria-busy={!ready}>
        <PaymentElement
          onReady={() => setReady(true)}
          onLoadError={() => setError('Secure payment form unavailable.')}
        />
      </div>
      {error && <p role="alert">{error}</p>}
      <div style={{ display: 'flex', gap: 12, marginTop: 20 }}>
        <button type="button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!ready || busy || !stripe}
        >
          {busy ? 'Confirming…' : 'Pay securely'}
        </button>
      </div>
    </div>
  )
}

export function StripeOrderPayment({
  prepare,
  onComplete,
  onCancel,
}: {
  prepare: () => Promise<Confirmation>
  onComplete: () => Promise<void>
  onCancel: () => void
}) {
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    prepare()
      .then((value) => {
        if (active) setConfirmation(value)
      })
      .catch((e) => {
        if (active)
          setError(
            e instanceof Error ? e.message : 'Unable to prepare payment.'
          )
      })
    return () => {
      active = false
    }
  }, [prepare])
  if (error)
    return (
      <div>
        <p role="alert">{error}</p>
        <button type="button" onClick={onCancel}>
          Close
        </button>
      </div>
    )
  if (!confirmation)
    return (
      <p role="status" aria-busy="true">
        Preparing secure payment…
      </p>
    )
  const stripe = getStripeClient()
  if (!stripe) return <p role="alert">Secure payment is unavailable.</p>
  return (
    <Elements
      stripe={stripe}
      options={{ clientSecret: confirmation.clientSecret }}
    >
      <PaymentForm onComplete={onComplete} onCancel={onCancel} />
    </Elements>
  )
}
