import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { createShopMembershipRepository } from '@/lib/server/shop-membership-repository'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (Object.keys(req.query).length)
      throw new ListingApiError('Membership does not accept query parameters.')
    return res
      .status(200)
      .json(
        await createShopMembershipRepository({ req, res }).getOwnMembership()
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
