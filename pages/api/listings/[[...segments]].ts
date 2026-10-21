import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  createListing,
  createShopListing,
  finalizeListing,
  abandonListing,
  deleteListing,
  getListing,
  getCreationListing,
  getListings,
  getMyListings,
  markListingSold,
  updateListing,
} from '@/lib/listings-api'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import type { ListingQuery } from '@/types/listing'

export function queryFromRequest(req: NextApiRequest): ListingQuery {
  const query: Record<string, number | string> = {}
  for (const key of [
    'search',
    'pickupArea',
    'category',
    'subcategory',
    'condition',
    'status',
    'sort',
    'minPrice',
    'maxPrice',
    'page',
    'pageSize',
    'channel',
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

const listingActions = {
  creation: getCreationListing,
  finalize: finalizeListing,
  abandon: abandonListing,
  sold: markListingSold,
}

// eslint-disable-next-line complexity -- Preserve existing route actions and add only the explicit Shop-create namespace with its strict envelope.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  const parts = requestSegments(req)
  const [id, action] = parts
  let allowed: string[] = []
  if (parts.length === 0) allowed = ['GET', 'POST']
  else if (parts.length === 1)
    allowed = id === 'shop' ? ['POST'] : ['GET', 'PATCH', 'DELETE']
  else if (
    parts.length === 2 &&
    ['sold', 'finalize', 'abandon'].includes(action)
  )
    allowed = ['POST']
  if (parts.length === 2 && action === 'creation') allowed = ['GET']
  if (!allowed.length) return res.status(404).json({ error: 'Not found.' })
  if (!req.method || !allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', '))
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (req.method !== 'GET') requireSameOriginWrite(req)
    const context = { req, res }
    if (id === 'shop' && parts.length === 1) {
      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        Object.keys(req.body).sort().join(',') !== 'actionId,input' ||
        typeof req.body.actionId !== 'string'
      )
        throw new ListingApiError(
          'Provide only product input and creation action ID.'
        )
      return res
        .status(201)
        .json(
          await createShopListing(req.body.input, req.body.actionId, context)
        )
    }
    if (!id) {
      if (req.method === 'POST')
        return res.status(201).json(await createListing(req.body, context))
      return res
        .status(200)
        .json(
          req.query.mine === 'true'
            ? await getMyListings(
                { channel: queryFromRequest(req).channel },
                context
              )
            : await getListings(queryFromRequest(req), context)
        )
    }
    if (action) {
      const actionHandler =
        listingActions[action as keyof typeof listingActions]
      return res.status(200).json((await actionHandler(id, context)) ?? null)
    }
    if (req.method === 'PATCH')
      return res.status(200).json(await updateListing(id, req.body, context))
    if (req.method === 'DELETE') {
      await deleteListing(id, context)
      return res.status(200).json(null)
    }
    return res.status(200).json(await getListing(id, context))
  } catch (error) {
    recordCleanupFailure(action, id, error)
    if (error instanceof ListingApiError)
      return res.status(error.status).json({ error: error.message })
    return res.status(500).json({
      error: 'Unable to complete the listing request. Please try again.',
    })
  }
}

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } }

function recordCleanupFailure(action: string, id: string, error: unknown) {
  if (action !== 'abandon' || !/^[0-9a-f-]{36}$/i.test(id)) return
  // eslint-disable-next-line no-console -- Trace only the listing identifier and status.
  console.warn('Listing draft cleanup unconfirmed', {
    listingId: id,
    status: error instanceof ListingApiError ? error.status : 500,
  })
}

function requestSegments(req: NextApiRequest) {
  const segments = req.query.segments || []
  return Array.isArray(segments) ? segments : [segments]
}
