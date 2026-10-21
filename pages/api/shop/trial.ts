import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createShopMembershipRepository } from '@/lib/server/shop-membership-repository'

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } }

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
    if (Object.keys(req.query).length)
      throw new ListingApiError('Trial does not accept query parameters.')
    requireSameOriginWrite(req)
    return res
      .status(200)
      .json(
        await createShopMembershipRepository({ req, res }).claimOwnTrial(
          req.body
        )
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Shop membership unavailable. Please retry.',
      })
  }
}
