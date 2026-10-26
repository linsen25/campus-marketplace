import { createHmac, randomInt } from 'crypto'

import { createClient } from '@supabase/supabase-js'

import { ListingApiError } from '@/lib/listing-validation'
import {
  createMarketplaceClient,
  type MarketplaceContext,
} from '@/lib/supabase/server'

const uwo = /^[^\s@]+@uwo\.ca$/i

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key)
    throw new ListingApiError('UWO verification is not configured.', 503)
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
}

function codeHash(code: string) {
  const secret = process.env.UWO_VERIFICATION_CODE_SECRET
  if (!secret)
    throw new ListingApiError('UWO verification is not configured.', 503)
  return createHmac('sha256', secret).update(code).digest('hex')
}

async function deliver(email: string, code: string) {
  const endpoint = process.env.UWO_VERIFICATION_EMAIL_WEBHOOK_URL
  if (!endpoint)
    throw new ListingApiError(
      'UWO verification email is temporarily unavailable.',
      503
    )
  let target: URL
  try {
    target = new URL(endpoint)
  } catch {
    throw new ListingApiError(
      'UWO verification email is temporarily unavailable.',
      503
    )
  }
  if (target.protocol !== 'https:')
    throw new ListingApiError(
      'UWO verification email is temporarily unavailable.',
      503
    )
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      to: email,
      purpose: 'uwo-email-verification',
      code,
    }),
  })
  if (!response.ok)
    throw new ListingApiError('UWO verification email could not be sent.', 503)
}

export async function uwoVerificationStatus(context: MarketplaceContext) {
  const client = createMarketplaceClient(context)
  const { data: auth, error } = await client.auth.getUser()
  if (error || !auth.user)
    throw new ListingApiError('Log in to manage UWO verification.', 401)
  const { data, error: rpcError } = await adminClient()
    .schema('marketplace_private')
    .rpc('is_uwo_email_verified', { p_user_id: auth.user.id })
  if (rpcError)
    throw new ListingApiError(
      'UWO verification is temporarily unavailable.',
      503
    )
  return { verified: data === true }
}

export async function sendUwoVerification(
  context: MarketplaceContext,
  email: unknown
) {
  const client = createMarketplaceClient(context)
  const { data: auth, error } = await client.auth.getUser()
  if (error || !auth.user)
    throw new ListingApiError('Log in to manage UWO verification.', 401)
  if (typeof email !== 'string' || !uwo.test(email.trim()))
    throw new ListingApiError('Enter a valid UWO email address.')
  const normalized = email.trim().toLowerCase()
  const code = String(randomInt(100000, 1000000))
  const { data: admitted, error: rpcError } = await adminClient()
    .schema('marketplace_private')
    .rpc('begin_uwo_email_verification', {
      p_user_id: auth.user.id,
      p_uwo_email: normalized,
      p_code_hash: codeHash(code),
      p_expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    })
  if (rpcError) {
    if (rpcError.code === '23505')
      throw new ListingApiError(
        'That UWO email is already verified on another account.',
        409
      )
    if (rpcError.code === '22023')
      throw new ListingApiError(
        'Please wait before requesting another code.',
        429
      )
    throw new ListingApiError(
      'UWO verification is temporarily unavailable.',
      503
    )
  }
  if (admitted !== true)
    throw new ListingApiError(
      'Please wait before requesting another code.',
      429
    )
  await deliver(normalized, code)
  return { sent: true, expiresInSeconds: 600 }
}

export async function completeUwoVerification(
  context: MarketplaceContext,
  value: unknown
) {
  const client = createMarketplaceClient(context)
  const { data: auth, error } = await client.auth.getUser()
  if (error || !auth.user)
    throw new ListingApiError('Log in to manage UWO verification.', 401)
  if (typeof value !== 'string' || !/^\d{6}$/.test(value))
    throw new ListingApiError('Enter the six-digit verification code.')
  const { data, error: rpcError } = await adminClient()
    .schema('marketplace_private')
    .rpc('complete_uwo_email_verification', {
      p_user_id: auth.user.id,
      p_code_hash: codeHash(value),
    })
  if (rpcError)
    throw new ListingApiError(
      'UWO verification is temporarily unavailable.',
      503
    )
  if (data !== true)
    throw new ListingApiError('That code is invalid or expired.', 400)
  return { verified: true }
}
