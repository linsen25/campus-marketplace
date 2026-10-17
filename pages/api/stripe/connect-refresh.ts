import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { startPayoutSetup } from '@/lib/server/stripe-setup'
import { createMarketplaceClient } from '@/lib/supabase/server'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  try {
    if (req.method !== 'GET') return res.status(405).end()
    if (
      typeof req.query.state !== 'string' ||
      !/^[a-f0-9]{64}$/.test(req.query.state) ||
      Object.keys(req.query).length !== 1
    )
      throw new ListingApiError('Invalid setup link.', 403)
    const user = await requireMarketplaceUser(
      createMarketplaceClient({ req, res })
    )
    const link = await startPayoutSetup(user.id, req.query.state)
    return res.redirect(303, link.url)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .send(
        'Unable to resume setup. Return to Settings and choose Set up payouts to continue.'
      )
  }
}
