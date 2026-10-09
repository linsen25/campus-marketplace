// Server-only. The pending capability is never returned in JSON.
import { randomBytes } from 'crypto'

import { parseCookieHeader, serializeCookieHeader } from '@supabase/ssr'
import { createClient } from '@supabase/supabase-js'
import type { NextApiRequest, NextApiResponse } from 'next'

import { pendingSignupUnavailableMessage } from '@/lib/auth-pending'
import { ListingApiError } from '@/lib/listing-validation'
import { requireMessagesEnvironment } from '@/lib/server/messages-environment'

const cookieName = 'marketplace-pending-signup'
export const newSignupTicket = () => randomBytes(32).toString('hex')

export function setSignupTicket(
  req: NextApiRequest,
  res: NextApiResponse,
  ticket: string
) {
  const previous = res.getHeader('Set-Cookie') || []
  res.setHeader('Set-Cookie', [
    ...(Array.isArray(previous) ? previous.map(String) : [String(previous)]),
    serializeCookieHeader(cookieName, ticket, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: ticket ? 86400 : 0,
      secure:
        process.env.NODE_ENV === 'production' &&
        !/^(localhost|127\.0\.0\.1)(:|$)/.test(req.headers.host || ''),
    }),
  ])
}

export async function correctPendingUsername(
  req: NextApiRequest,
  email: string,
  username: string
) {
  const ticket = parseCookieHeader(req.headers.cookie || '').find(
    ({ name }) => name === cookieName
  )?.value
  if (!ticket || !/^[0-9a-f]{64}$/.test(ticket))
    throw new ListingApiError(pendingSignupUnavailableMessage, 403)
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
    throw new ListingApiError('Signup editing is temporarily unavailable.', 503)
  const admin = createClient(`https://${ref}.supabase.co`, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  })
  const { error } = await admin.rpc('marketplace_correct_pending_username', {
    p_ticket: ticket,
    p_email: email,
    p_username: username,
  })
  if (error) {
    if (error.code === '42501')
      throw new ListingApiError(pendingSignupUnavailableMessage, 403)
    let message =
      'Pending signup editing is unavailable. Use the original details or resume verification.'
    if (error.code === '23505') message = 'That username is already taken.'
    if (error.code === '23514')
      message = 'Choose a valid, non-reserved username.'
    throw new ListingApiError(message, error.code === '23505' ? 409 : 400)
  }
}
