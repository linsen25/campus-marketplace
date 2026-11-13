// Server-only capability. Never import from components or browser API modules.
import { createClient } from '@supabase/supabase-js'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMessagesEnvironment } from '@/lib/server/messages-environment'
import { requireUuServerSecret } from '@/lib/server/supabase-secret'

export function requireImageEnvironment() {
  const ref = requireMessagesEnvironment()
  let secret: ReturnType<typeof requireUuServerSecret>
  try {
    secret = requireUuServerSecret()
  } catch {
    throw new ListingApiError('Private image storage is not configured.', 503)
  }
  if (secret.ref !== ref)
    throw new ListingApiError('Private image storage is not configured.', 503)
  return secret.key
}
export function imageSendingEnabled() {
  try {
    requireImageEnvironment()
    return true
  } catch {
    return false
  }
}
export function createChatStorage(signal?: AbortSignal) {
  const key = requireImageEnvironment()
  const ref = requireMessagesEnvironment()
  return createClient(`https://${ref}.supabase.co`, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, options) =>
        fetch(input, { ...options, ...(signal ? { signal } : {}) }),
    },
  })
}
