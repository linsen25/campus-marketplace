import { createClient } from '@supabase/supabase-js'

import type { PasswordChangeResult } from '@/lib/auth-change-password'
import { validSignupPassword } from '@/lib/auth-password'
import { ListingApiError, listingInputRecord } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import type { MarketplaceContext } from '@/lib/supabase/server'
import { createMarketplaceClient } from '@/lib/supabase/server'

// GoTrueClient.signOut deliberately suppresses some 401/403/404 errors. For a
// security-sensitive confirmation, require an actual successful logout response.
function logoutTransport() {
  let succeeded = false
  const request: typeof fetch = async (input, init) => {
    const response = await fetch(input, init)
    const url = new URL(input instanceof Request ? input.url : String(input))
    if (url.pathname === '/auth/v1/logout') succeeded = response.ok
    return response
  }
  return { request, succeeded: () => succeeded }
}

function passwordFailure(error: { code?: string; status?: number }): never {
  if (
    error.code === 'reauthentication_needed' ||
    error.code === 'reauthentication_not_valid'
  )
    throw new ListingApiError(
      'Additional identity verification is required. Your password was not changed. Use password recovery.',
      403
    )
  if (error.code === 'weak_password')
    throw new ListingApiError(
      'Password does not meet the required security rules.'
    )
  if (error.code === 'same_password')
    throw new ListingApiError(
      'Choose a password different from your current password.'
    )
  if (
    error.code === 'current_password_mismatch' ||
    error.code === 'current_password_required'
  )
    throw new ListingApiError('Current password is incorrect.')
  throw new ListingApiError(
    error.status === 429
      ? 'Too many requests. Please wait before trying again.'
      : 'Unable to change your password. Please try again.',
    error.status === 429 ? 429 : 400
  )
}

function passwordInput(input: unknown) {
  const body = listingInputRecord(input)
  if (
    Object.keys(body).some(
      (key) => !['currentPassword', 'password', 'confirmation'].includes(key)
    )
  )
    throw new ListingApiError('Invalid password change fields.')
  if (typeof body.currentPassword !== 'string' || !body.currentPassword)
    throw new ListingApiError('Enter your current password.')
  if (!validSignupPassword(body.password))
    throw new ListingApiError(
      'Password does not meet the required security rules.'
    )
  if (body.confirmation !== body.password)
    throw new ListingApiError('Passwords do not match.')
  return { currentPassword: body.currentPassword, password: body.password }
}

export async function changeAuthenticatedPassword(
  context: MarketplaceContext,
  input: unknown
): Promise<PasswordChangeResult> {
  const transport = logoutTransport()
  const client = createMarketplaceClient(context, transport.request)
  const user = await requireMarketplaceUser(client)
  const body = passwordInput(input)

  // Native current_password enforcement depends on Auth configuration and can
  // exempt recovery sessions. Verify via Auth as well, in an isolated ephemeral
  // client: no cookies, storage, admin credentials, or replacement of this device.
  const proofTransport = logoutTransport()
  const proof = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: { fetch: proofTransport.request },
    }
  )
  const { data: verified, error: proofError } =
    await proof.auth.signInWithPassword({
      email: user.email!,
      password: body.currentPassword,
    })
  if (proofError || !verified.session) {
    throw new ListingApiError(
      proofError?.status === 429
        ? 'Too many requests. Please wait before trying again.'
        : 'Unable to verify your current password. Check it and try again.',
      proofError?.status === 429 ? 429 : 400
    )
  }
  const { error: cleanupError } = await proof.auth.signOut({ scope: 'local' })
  if (cleanupError || !proofTransport.succeeded())
    throw new ListingApiError(
      'Unable to finish identity verification. Your password was not changed. Please retry.',
      503
    )
  if (verified.user?.id !== user.id)
    throw new ListingApiError('Unable to verify your identity.', 403)

  let updated
  try {
    updated = await client.auth.updateUser({
      current_password: body.currentPassword,
      password: body.password,
    })
  } catch {
    return {
      passwordUpdated: null,
      otherSessionsRevoked: false,
      error:
        'Unable to confirm whether your password changed. Do not submit again; check by signing in or use password recovery.',
    }
  }
  if (updated.error) {
    // A transport failure can occur after the provider committed the update.
    if (!updated.error.status || updated.error.status >= 500)
      return {
        passwordUpdated: null,
        otherSessionsRevoked: false,
        error:
          'Unable to confirm whether your password changed. Do not submit again; check by signing in or use password recovery.',
      }
    passwordFailure(updated.error)
  }
  if (updated.data.user?.id !== user.id)
    return {
      passwordUpdated: null,
      otherSessionsRevoked: false,
      error:
        'Unable to confirm the password change. Check by signing in before retrying.',
    }
  try {
    const { error } = await client.auth.signOut({ scope: 'others' })
    if (!error && transport.succeeded())
      return { passwordUpdated: true, otherSessionsRevoked: true }
  } catch {
    // Password already changed. Never encourage another password write as retry.
  }
  return {
    passwordUpdated: true,
    otherSessionsRevoked: false,
    error:
      'Your password was changed, but other device sessions could not be revoked. Do not change your password again to retry this step.',
  }
}
