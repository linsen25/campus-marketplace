import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireUsername } from '@/lib/server/auth-username'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

// Wire the existing authoritative RPC, using the same auth/CSRF boundary as
// existing marketplace writes. No direct profile UPDATE or replacement rules.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    requireSameOriginWrite(req)
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    const candidate = requireUsername(req.body?.username)
    const { data, error } = await client.rpc('marketplace_change_username', {
      candidate,
    })
    if (error)
      throw new ListingApiError(
        ['23514', '23505', 'P0001', '42501'].includes(error.code)
          ? error.message
          : 'Unable to change your username. Please retry.',
        400
      )
    return res.status(200).json(data)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to change your username. Please retry.',
      })
  }
}
