import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  getPublicShop,
  getPublicShopListing,
  getPublicShopProducts,
  getPublicShops,
} from '@/lib/server/public-shop'
import type { PublicShopQuery } from '@/types/shop'

function parseQuery(req: NextApiRequest): PublicShopQuery {
  if (
    Object.keys(req.query).some(
      (key) => !['segments', 'q', 'kind'].includes(key)
    ) ||
    (req.query.kind !== undefined &&
      (typeof req.query.kind !== 'string' ||
        !['products', 'listing'].includes(req.query.kind)))
  )
    throw new ListingApiError('Invalid public Shop query.')
  const raw = req.query.q ?? '{}'
  if (typeof raw !== 'string' || raw.length > 8192)
    throw new ListingApiError('Invalid public Shop query.')
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      throw new Error('Object required')
    return parsed
  } catch {
    throw new ListingApiError('Invalid public Shop query.')
  }
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    const parts = req.query.segments
    if (parts && (!Array.isArray(parts) || parts.length !== 1))
      return res.status(404).json({ error: 'Not found.' })
    const query = parseQuery(req)
    if (req.query.kind === 'listing') {
      if (
        !query ||
        typeof query !== 'object' ||
        Array.isArray(query) ||
        Object.keys(query).join(',') !== 'id' ||
        typeof (query as { id?: unknown }).id !== 'string'
      )
        throw new ListingApiError('Invalid public Shop query.')
      return res
        .status(200)
        .json(await getPublicShopListing((query as { id: string }).id))
    }
    let data
    if (parts) data = await getPublicShop(parts[0], query)
    else if (req.query.kind === 'products')
      data = await getPublicShopProducts(query)
    else data = await getPublicShops(query)
    return res.status(200).json(data)
  } catch (error) {
    const status = error instanceof ListingApiError ? error.status : 503
    return res.status(status).json({
      error:
        status === 400
          ? 'Invalid public Shop query.'
          : 'Unable to load Shops. Please retry.',
    })
  }
}
