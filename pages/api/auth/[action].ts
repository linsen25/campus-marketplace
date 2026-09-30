import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError, listingInputRecord } from '@/lib/listing-validation'
import { isWesternEmail } from '@/lib/marketplace-auth'
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

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const action = req.query.action
  if (!['session', 'email', 'verify', 'sign-out'].includes(String(action)))
    return res.status(404).json({ error: 'Not found.' })
  const method = action === 'session' ? 'GET' : 'POST'
  if (req.method !== method) {
    res.setHeader('Allow', method)
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (action === 'session')
      return res
        .status(200)
        .json({ seller: await getMarketplaceSession({ req, res }) })
    requireSameOriginWrite(req)
    const client = createMarketplaceClient({ req, res })
    if (action === 'sign-out') {
      const { error } = await client.auth.signOut({ scope: 'local' })
      if (error)
        throw new ListingApiError('Unable to sign out. Please retry.', 503)
      return res.status(200).json(null)
    }
    const body = listingInputRecord(req.body)
    if (!isWesternEmail(body.email))
      throw new ListingApiError('Use an email address ending in @uwo.ca.')
    const email = body.email.trim().toLowerCase()
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
