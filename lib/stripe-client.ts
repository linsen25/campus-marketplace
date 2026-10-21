import type { Stripe } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'

let cached: Promise<Stripe | null> | null = null

export const stripeClientAvailable = () =>
  /^pk_test_[A-Za-z0-9]+$/.test(
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  )

export function getStripeClient(key?: string) {
  const configured = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  if (!stripeClientAvailable() || (key !== undefined && key !== configured))
    throw new Error('Secure payment service unavailable')
  if (!cached)
    cached = loadStripe(configured).catch(() => {
      cached = null
      return null
    })
  return cached
}
