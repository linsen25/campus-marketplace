import type { NextApiRequest, NextApiResponse } from 'next'

import { passwordRules, validSignupPassword } from '@/lib/auth-password'
import { usernameTakenMessage } from '@/lib/auth-username'
import { ListingApiError, listingInputRecord } from '@/lib/listing-validation'
import { isWesternEmail } from '@/lib/marketplace-auth'
import {
  confirmUsername,
  requireUsername,
  usernameAvailable,
} from '@/lib/server/auth-username'
import {
  getMarketplaceSession,
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

function authFailure(res: NextApiResponse, error: unknown) {
  const status = error instanceof ListingApiError ? error.status : 500
  const message =
    error instanceof ListingApiError
      ? error.message
      : 'Authentication is temporarily unavailable.'
  return res.status(status).json({ error: message })
}

function signupDiagnosticMessage(message: string, secrets: unknown[]) {
  return secrets
    .reduce<string>(
      (safe, secret) =>
        typeof secret === 'string' && secret
          ? safe.split(secret).join('[redacted]')
          : safe,
      message
    )
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted email]')
    .replace(
      /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g,
      '[redacted token]'
    )
}

type SignupProviderFailure = { status: number; code?: string; message: string }

function signupDiagnosticFetch(
  record: (failure: SignupProviderFailure) => void
): typeof fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    const url = input instanceof Request ? input.url : String(input)
    if (!response.ok && new URL(url).pathname === '/auth/v1/signup') {
      const body = await response
        .clone()
        .json()
        .catch(() => null)
      const code = body?.code || body?.error_code
      const message = body?.msg || body?.message || body?.error_description
      record({
        status: response.status,
        code: typeof code === 'string' ? code : undefined,
        message: typeof message === 'string' ? message : response.statusText,
      })
    }
    return response
  }
}

// This dispatcher keeps existing OTP and new password actions on one auth API.
// eslint-disable-next-line complexity
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const action = req.query.action
  if (
    ![
      'session',
      'email',
      'verify',
      'sign-out',
      'sign-in',
      'signup-code',
      'resend-signup',
      'verify-signup',
      'recover',
      'reset-password',
      'username-availability',
    ].includes(String(action))
  )
    return res.status(404).json({ error: 'Not found.' })
  const method = ['session', 'username-availability'].includes(String(action))
    ? 'GET'
    : 'POST'
  if (req.method !== method) {
    res.setHeader('Allow', method)
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (action === 'session')
      return res
        .status(200)
        .json({ seller: await getMarketplaceSession({ req, res }) })
    if (action === 'username-availability') {
      const candidate = requireUsername(req.query.username)
      const client = createMarketplaceClient({ req, res })
      return res
        .status(200)
        .json({ available: await usernameAvailable(client, candidate) })
    }
    requireSameOriginWrite(req)
    let signupProviderFailure: SignupProviderFailure | undefined
    const client = createMarketplaceClient(
      { req, res },
      action === 'signup-code'
        ? signupDiagnosticFetch((failure) => {
            signupProviderFailure = failure
          })
        : undefined
    )
    if (action === 'sign-out') {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error)
        throw new ListingApiError('Unable to sign out. Please retry.', 503)
      return res.status(200).json(null)
    }
    const body = listingInputRecord(req.body)
    if (!isWesternEmail(body.email))
      throw new ListingApiError('Use your Western email to continue.')
    const email = body.email.trim().toLowerCase()
    const failAuth = (
      error: { status?: number; code?: string } | null,
      fallback: string
    ) => {
      if (!error) return
      // Safe diagnostic codes only: no passwords, tokens, emails or raw provider messages.
      // eslint-disable-next-line no-console -- Safe provider diagnostic codes for server-side troubleshooting.
      console.error('Marketplace auth request failed', {
        action,
        providerStatus: error.status,
        providerCode: error.code,
      })
      const message =
        error.code === 'weak_password'
          ? 'Password does not meet the required security rules.'
          : fallback
      throw new ListingApiError(
        error.status === 429 || error.code === 'over_email_send_rate_limit'
          ? 'Too many requests. Please wait before trying again.'
          : message,
        error.status === 429 ? 429 : 400
      )
    }
    const verifiedSession = async () => {
      try {
        await requireMarketplaceUser(client)
      } catch (cause) {
        await client.auth.signOut({ scope: 'local' })
        throw cause
      }
    }
    if (action === 'sign-in') {
      if (typeof body.password !== 'string' || !body.password)
        throw new ListingApiError('Enter your email and password.')
      const { error } = await client.auth.signInWithPassword({
        email,
        password: body.password,
      })
      failAuth(
        error,
        'Unable to log in. Check your email and password, and confirm your email if needed.'
      )
      await verifiedSession()
      return res.status(200).json(null)
    }
    if (action === 'recover') {
      const { error } = await client.auth.resetPasswordForEmail(email)
      failAuth(error, 'Unable to send a recovery code. Please try again later.')
      return res.status(200).json(null)
    }
    if (
      ['signup-code', 'resend-signup', 'verify-signup'].includes(String(action))
    ) {
      requireUsername(body.username)
      if (body.agreement !== true)
        throw new ListingApiError(
          'Agree to the Campus Marketplace rules to continue.'
        )
      if (!validSignupPassword(body.password))
        throw new ListingApiError(
          'Your password must meet all four requirements.'
        )
    }
    if (action === 'signup-code') {
      const username = requireUsername(body.username)
      if (!(await usernameAvailable(client, username)))
        throw new ListingApiError(usernameTakenMessage, 409)
      const { data, error } = await client.auth.signUp({
        email,
        password: body.password as string,
        options: {
          data: { username, display_name: username, marketplace_signup: true },
        },
      })
      if (error) {
        // Capture the provider failure before availability/error mapping can mask it.
        // eslint-disable-next-line no-console -- Server-only sanitized signup diagnostics.
        console.error('Marketplace signup provider failure', {
          method: 'auth.signUp',
          passwordFacts: {
            length: (body.password as string).length,
            hasUppercase: passwordRules[1].test(body.password as string),
            hasNumber: passwordRules[2].test(body.password as string),
            hasSymbol: passwordRules[3].test(body.password as string),
            // Observation only; lowercase is NOT an application requirement.
            hasLowercase: /[a-z]/.test(body.password as string),
          },
          request: {
            email: '[redacted]',
            password: '[redacted]',
            options: {
              data: {
                username,
                display_name: username,
                marketplace_signup: true,
              },
            },
          },
          providerStatus: signupProviderFailure?.status ?? error.status,
          providerCode: signupProviderFailure?.code ?? error.code,
          providerMessage: signupDiagnosticMessage(
            signupProviderFailure?.message || error.message,
            [
              email,
              body.email,
              body.password,
              body.code,
              process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            ]
          ),
        })
      }
      if (error && !(await usernameAvailable(client, username)))
        throw new ListingApiError(usernameTakenMessage, 409)
      failAuth(
        error,
        'Unable to create the account or send verification. If you already have an account, log in or reset your password.'
      )
      if (data.session) {
        await client.auth.signOut({ scope: 'local' })
        throw new ListingApiError(
          'Email confirmation must be enabled before registration is available.',
          503
        )
      }
      if (data.user?.identities?.length === 0)
        throw new ListingApiError(
          'Unable to register this address. If you already have an account, log in or reset your password.'
        )
      return res.status(200).json(null)
    }
    if (action === 'resend-signup') {
      const { error } = await client.auth.resend({ email, type: 'signup' })
      failAuth(error, 'Unable to resend verification. Please try again later.')
      return res.status(200).json(null)
    }
    if (action === 'verify-signup' || action === 'reset-password') {
      if (typeof body.code !== 'string' || !/^\d{6,10}$/.test(body.code))
        throw new ListingApiError(
          'Enter the verification code from your email.'
        )
      if (action === 'reset-password' && !validSignupPassword(body.password))
        throw new ListingApiError(
          'Your password must meet all four requirements.'
        )
      const { error } = await client.auth.verifyOtp({
        email,
        token: body.code,
        type: action === 'reset-password' ? 'recovery' : 'email',
      })
      failAuth(
        error,
        'This code is incorrect or expired. Request another code.'
      )
      await verifiedSession()
      if (action === 'verify-signup') {
        try {
          await confirmUsername(client, requireUsername(body.username))
        } catch (cause) {
          await client.auth.signOut({ scope: 'local' })
          throw cause
        }
        // signUp already assigned the password. Keep the verified session;
        // signup must not depend on a second password write succeeding.
        return res.status(200).json(null)
      }
      // Recovery still assigns its new password after recovery OTP verification.
      const { error: passwordError } = await client.auth.updateUser({
        password: body.password as string,
      })
      if (passwordError) {
        await client.auth.signOut({ scope: 'local' })
        failAuth(
          passwordError,
          'Unable to save this password. Request another code and try again.'
        )
      }
      return res.status(200).json(null)
    }
    if (action === 'email') {
      const displayName =
        typeof body.displayName === 'string' ? body.displayName.trim() : ''
      if (displayName.length > 60)
        throw new ListingApiError('Display name must be at most 60 characters.')
      const { error } = await client.auth.signInWithOtp({
        email,
        options: {
          shouldCreateUser: true,
          data: { display_name: displayName || 'Western member' },
        },
      })
      if (error)
        throw new ListingApiError(
          'Unable to send a code. Check the address or wait before trying again.',
          error.status === 429 ? 429 : 400
        )
      return res.status(200).json(null)
    }
    if (typeof body.code !== 'string' || !/^\d{6,10}$/.test(body.code))
      throw new ListingApiError('Enter the code from your email.')
    const { error } = await client.auth.verifyOtp({
      email,
      token: body.code,
      type: 'email',
    })
    if (error)
      throw new ListingApiError(
        'This code is invalid or expired. Request another code.'
      )
    try {
      await requireMarketplaceUser(client)
    } catch (cause) {
      await client.auth.signOut({ scope: 'local' })
      throw cause
    }
    return res.status(200).json(null)
  } catch (error) {
    return authFailure(res, error)
  }
}

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } }
