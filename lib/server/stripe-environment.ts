// Server only. No environment values from this module may be returned or logged.
import { ListingApiError } from '@/lib/listing-validation'
import { requireMessagesEnvironment } from '@/lib/server/messages-environment'

export const stripeApiVersion = '2026-09-30.endive' as const
export const stripeRequested = () =>
  process.env.STRIPE_PROVIDER_ENABLED === 'true'
// eslint-disable-next-line complexity -- All independent environment/mode/origin checks must fail closed.
export function stripeConfiguration() {
  if (typeof window !== 'undefined')
    throw new Error('Server-only Stripe service.')
  const secretKey = process.env.STRIPE_SECRET_KEY || ''
  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || ''
  const platform = process.env.STRIPE_PLATFORM_ACCOUNT_ID || ''
  const secrets = {
    platform: process.env.STRIPE_WEBHOOK_SECRET || '',
    connected: process.env.STRIPE_CONNECT_WEBHOOK_SECRET || '',
    account: process.env.STRIPE_ACCOUNT_WEBHOOK_SECRET || '',
  }
  let origin = ''
  try {
    const value = new URL(process.env.STRIPE_APPLICATION_ORIGIN || '')
    if (
      value.username ||
      value.password ||
      value.pathname !== '/' ||
      value.search ||
      value.hash
    )
      throw new Error('origin')
    if (
      value.protocol !== 'https:' &&
      !(
        value.protocol === 'http:' &&
        ['localhost', '127.0.0.1'].includes(value.hostname)
      )
    )
      throw new Error('origin')
    origin = value.origin
  } catch {
    /* Missing/invalid configuration fails closed below. */
  }
  if (
    !stripeRequested() ||
    process.env.APP_ENV !== 'staging' ||
    requireMessagesEnvironment() !== 'pcaqxezdfxofysghssyo' ||
    !/^sk_test_[A-Za-z0-9]+$/.test(secretKey) ||
    !/^pk_test_[A-Za-z0-9]+$/.test(publishableKey) ||
    !/^acct_[A-Za-z0-9]+$/.test(platform) ||
    process.env.STRIPE_API_VERSION !== stripeApiVersion ||
    (process.env.STRIPE_WORKER_SECRET || '').length < 32 ||
    !origin ||
    Object.values(secrets).some((value) => !/^whsec_[A-Za-z0-9]+$/.test(value))
  ) {
    throw new ListingApiError(
      'Secure account setup is unavailable. Please try again later.',
      503
    )
  }
  return { secretKey, publishableKey, platform, secrets, origin }
}
