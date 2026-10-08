import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { requireMessagesEnvironment } from '@/lib/server/messages-environment'
import { createMarketplaceClient } from '@/lib/supabase/server'

// Existing server-owned session only. No refresh token or privileged credential.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    requireSameOriginWrite(req)
    const ref = requireMessagesEnvironment()
    const client = createMarketplaceClient({ req, res })
    const user = await requireMarketplaceUser(client)
    const { data, error } = await client.auth.getSession()
    const session = data.session
    if (error || !session || session.user.id !== user.id)
      throw new ListingApiError('Your session is unavailable.', 401)
    const claims = JSON.parse(
      Buffer.from(session.access_token.split('.')[1], 'base64url').toString()
    )
    if (
      claims.sub !== user.id ||
      claims.role !== 'authenticated' ||
      claims.iss !== `https://${ref}.supabase.co/auth/v1` ||
      !Number.isFinite(claims.exp) ||
      claims.exp <= Date.now() / 1000
    )
      throw new ListingApiError('Your session is unavailable.', 401)
    return res.status(200).json({
      accessToken: session.access_token,
      expiresAt: claims.exp,
      userId: user.id,
    })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to establish the Messages connection.',
      })
  }
}
