// Server-only guard for Supabase's opaque `sb_secret` keys.  API keys are not
// JWTs, so their project binding is established by the exact configured URL;
// never try to decode an opaque secret or accept a legacy service-role JWT.
import { ListingApiError } from '@/lib/listing-validation'
import {
  configuredUuProjectRef,
  marketplaceTestUrl,
} from '@/lib/marketplace-test-environment'

const secretKeyPattern = /^sb_secret_[A-Za-z0-9_-]+$/

export function requireUuServerSecret() {
  if (typeof window !== 'undefined')
    throw new ListingApiError('Server configuration is unavailable.', 503)
  const ref = configuredUuProjectRef()
  const key = process.env.SUPABASE_SECRET_KEY || ''
  if (!ref || !secretKeyPattern.test(key))
    throw new ListingApiError('Server configuration is unavailable.', 503)
  return { ref, key, url: marketplaceTestUrl(ref) }
}
