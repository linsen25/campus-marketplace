import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  createListing,
  deleteListing,
  getListing,
  getListings,
  getMyListings,
  markListingSold,
  updateListing,
} from '@/lib/listings-api'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import type { ListingQuery } from '@/types/listing'

function queryFromRequest(req: NextApiRequest): ListingQuery {
  const query: Record<string, number | string> = {}
  for (const key of [
    'search',
    'category',
    'condition',
    'status',
    'sort',
    'minPrice',
    'maxPrice',
    'page',
    'pageSize',
  ]) {
    const value = req.query[key]
    if (value !== undefined) {
      if (typeof value !== 'string')
        throw new ListingApiError(
          'Duplicate query parameters are not supported.'
        )
      if (['minPrice', 'maxPrice', 'page', 'pageSize'].includes(key)) {
        if (!/^\d+$/.test(value))
          throw new ListingApiError(
            'Price bounds and pagination must be integers.'
          )
        query[key] = Number(value)
      } else query[key] = value
    }
  }
  return query as ListingQuery
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  const segments = req.query.segments || []
  const parts = Array.isArray(segments) ? segments : [segments]
  const [id, action] = parts
  let allowed: string[] = []
  if (parts.length === 0) allowed = ['GET', 'POST']
  else if (parts.length === 1) allowed = ['GET', 'PATCH', 'DELETE']
  else if (parts.length === 2 && action === 'sold') allowed = ['POST']
  if (!allowed.length) return res.status(404).json({ error: 'Not found.' })
  if (!req.method || !allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '))
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (req.method !== 'GET') requireSameOriginWrite(req)
    const context = { req, res }
    if (!id) {
      if (req.method === 'POST')
        return res.status(201).json(await createListing(req.body, context))
      return res
        .status(200)
        .json(
          req.query.mine === 'true'
            ? await getMyListings(context)
            : await getListings(queryFromRequest(req), context)
        )
    }
    if (action === 'sold')
      return res.status(200).json(await markListingSold(id, context))
    if (req.method === 'PATCH')
      return res.status(200).json(await updateListing(id, req.body, context))
    if (req.method === 'DELETE') {
      await deleteListing(id, context)
      return res.status(200).json(null)
    }
    return res.status(200).json(await getListing(id, context))
  } catch (error) {
    if (error instanceof ListingApiError)
      return res.status(error.status).json({ error: error.message })
    return res.status(500).json({
      error: 'Unable to complete the listing request. Please try again.',
    })
  }
}

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } }
