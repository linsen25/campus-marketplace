import { ListingApiError } from '@/lib/listing-validation'
import {
  configuredMarketplaceTestRef,
  marketplaceTestProjects,
} from '@/lib/marketplace-test-environment'

export function requireMessagesEnvironment() {
  const designation = process.env.APP_ENV || ''
  const ref = configuredMarketplaceTestRef(designation)
  let valid = false
  try {
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''
    let publicKey = /^sb_publishable_[A-Za-z0-9_-]+$/.test(key)
    if (!publicKey && key.split('.').length === 3) {
      const claims = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64url').toString()
      )
      publicKey = claims.role === 'anon' && claims.ref === ref
    }
    valid = Boolean(
      ref &&
        Object.values(marketplaceTestProjects).includes(ref) &&
        publicKey
    )
  } catch {
    valid = false
  }
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
