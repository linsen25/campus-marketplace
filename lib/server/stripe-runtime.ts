// Server only. This is the single Stripe SDK construction and platform check.
import Stripe from 'stripe'

import { ListingApiError } from '@/lib/listing-validation'
import {
  stripeApiVersion,
  stripeConfiguration,
} from '@/lib/server/stripe-environment'

let cached:
  | { config: ReturnType<typeof stripeConfiguration>; stripe: Stripe }
  | undefined

export function stripeClient() {
  if (!cached) {
    const config = stripeConfiguration()
    cached = {
      config,
      stripe: new Stripe(config.secretKey, {
        apiVersion: stripeApiVersion,
        timeout: 10000,
        maxNetworkRetries: 1,
      }),
    }
  }
  return cached
}

export async function stripeRuntime() {
  const current = stripeClient()
  const account = await current.stripe.accounts.retrieve(null)
  if (account.id !== current.config.platform)
    throw new ListingApiError('Secure payment service is unavailable.', 503)
  return current
}
