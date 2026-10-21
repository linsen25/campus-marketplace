// Server-only Storage/RPC capability. Never returned to browser code.
import { setTimeout } from 'timers'

import { createClient } from '@supabase/supabase-js'

import { ListingApiError } from '@/lib/listing-validation'
import { requireImageEnvironment } from '@/lib/server/chat-image-storage'
import { requireMessagesEnvironment } from '@/lib/server/messages-environment'

export function avatarDeadline(milliseconds: number) {
  const controller = new AbortController()
  setTimeout(() => controller.abort(), milliseconds).unref()
  return controller.signal
}

export function requireAvatarEnvironment() {
  if (
    process.env.APP_ENV !== 'staging' ||
    requireMessagesEnvironment() !== 'pcaqxezdfxofysghssyo'
  )
    throw new ListingApiError('Avatar storage is unavailable.', 503)
  return requireImageEnvironment()
}
export function avatarRepository(signal?: AbortSignal) {
  const key = requireAvatarEnvironment()
  const client = createClient('https://pcaqxezdfxofysghssyo.supabase.co', key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: {
      fetch: (input, options) =>
        fetch(input, {
          ...options,
          signal: signal || avatarDeadline(30000),
        }),
    },
  })
  return { client, storage: client.storage.from('profile-avatars') }
}
export function avatarDatabaseError(error: { code?: string } | null) {
  if (!error) return
  const statuses: Record<string, number> = {
    '23505': 409,
    '42501': 403,
    '54000': 429,
  }
  const status = statuses[error.code || ''] || 503
  throw new ListingApiError(
    status === 409
      ? 'Your avatar changed. Please retry with the current avatar.'
      : 'Unable to save your avatar. Please retry.',
    status
  )
}
