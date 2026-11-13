import { ListingApiError } from '@/lib/listing-validation'
import { configuredUuProjectRef } from '@/lib/marketplace-test-environment'

export function requireMessagesEnvironment() {
  const designation = process.env.APP_ENV || ''
  const ref = configuredUuProjectRef(designation)
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
  const valid = Boolean(ref && /^sb_publishable_[A-Za-z0-9_-]+$/.test(key))
  if (!valid || !ref)
    throw new ListingApiError(
      'Messages environment configuration is unavailable.',
      503
    )
  return ref
}
export function messageUuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw new ListingApiError('A valid UUID is required.')
  return value
}
