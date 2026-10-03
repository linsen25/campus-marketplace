import {
  usernameInvalidMessage,
  usernameTakenMessage,
  usernameReservedMessage,
  reservedUsername,
  validUsername,
} from '@/lib/auth-username'
import { ListingApiError } from '@/lib/listing-validation'
import type { MarketplaceClient } from '@/lib/supabase/server'

export function requireUsername(value: unknown) {
  if (!validUsername(value)) throw new ListingApiError(usernameInvalidMessage)
  if (reservedUsername(value))
    throw new ListingApiError(usernameReservedMessage)
  return value
}
export async function usernameAvailable(
  client: MarketplaceClient,
  candidate: string
) {
  const { data, error } = await client.rpc('marketplace_username_available', {
    candidate,
  })
  if (error)
    throw new ListingApiError(
      'Username checking is unavailable. Please try again.',
      503
    )
  return data === true
}
export async function confirmUsername(
  client: MarketplaceClient,
  candidate: string
) {
  const { error } = await client.rpc('marketplace_confirm_username', {
    candidate,
  })
  if (error)
    throw new ListingApiError(
      error.code === '23505'
        ? usernameTakenMessage
        : 'Unable to confirm your username. Request another code and try again.',
      error.code === '23505' ? 409 : 503
    )
}
