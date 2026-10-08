// Server-only capability. Never import from components or browser API modules.
import { createClient } from '@supabase/supabase-js'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMessagesEnvironment } from '@/lib/server/messages-environment'

export function requireImageEnvironment() {
  const ref = requireMessagesEnvironment()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  let valid = false
  try {
    const claims = JSON.parse(
      Buffer.from(key.split('.')[1], 'base64url').toString()
    )
    valid = claims.role === 'service_role' && claims.ref === ref
  } catch {
    valid = false
  }
  if (!valid)
    throw new ListingApiError('Private image storage is not configured.', 503)
  return key
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
