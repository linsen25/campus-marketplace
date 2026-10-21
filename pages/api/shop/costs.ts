import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createShopCostsRepository } from '@/lib/server/shop-costs-repository'

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
    if (Object.keys(req.query).join(',') !== 'listingId')
      throw new ListingApiError('A product ID is required.')
    if (req.method === 'PATCH') requireSameOriginWrite(req)
    const repository = createShopCostsRepository({ req, res })
    return res
      .status(200)
      .json(
        await repository.cost(
          req.query.listingId,
          req.method === 'PATCH' ? req.body : undefined
        )
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Private Shop records unavailable.',
      })
  }
}
