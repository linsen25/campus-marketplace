import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createShopProfileRepository } from '@/lib/server/shop-profile-repository'

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!['GET', 'PATCH'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, PATCH')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (Object.keys(req.query).length)
      throw new ListingApiError(
        'Shop profile requests do not accept query parameters.'
      )
    if (req.method === 'PATCH') requireSameOriginWrite(req)
    const repository = createShopProfileRepository({ req, res })
    const shop =
      req.method === 'GET'
        ? await repository.getOwnShop()
        : await repository.updateOwnShop(req.body)
    return res.status(200).json(shop)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Shop profile unavailable. Please retry.',
      })
  }
}
