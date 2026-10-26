import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import {
  createShopProfileRepository,
  ownerShopETag,
} from '@/lib/server/shop-profile-repository'

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!['GET', 'POST', 'PATCH'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST, PATCH')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (Object.keys(req.query).length)
      throw new ListingApiError(
        'Shop profile requests do not accept query parameters.'
      )
    if (req.method === 'POST' || req.method === 'PATCH')
      requireSameOriginWrite(req)
    const repository = createShopProfileRepository({ req, res })
    if (req.method === 'POST') {
      const created = await repository.createOwnShop(req.body)
      if (created) res.setHeader('ETag', ownerShopETag(created))
      return res.status(201).json(created)
    }
    let condition: string | undefined
    if (req.headers['if-match'] !== undefined)
      condition =
        typeof req.headers['if-match'] === 'string'
          ? req.headers['if-match']
          : ''
    const shop =
      req.method === 'GET'
        ? await repository.getOwnShop()
        : await repository.updateOwnShop(req.body, condition)
    if (shop) res.setHeader('ETag', ownerShopETag(shop))
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
