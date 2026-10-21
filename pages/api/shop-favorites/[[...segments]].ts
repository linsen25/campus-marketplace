import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createShopFavoritesRepository } from '@/lib/server/shop-favorites'
import { shopUuid } from '@/lib/shop-favorites-api'

function integer(value: unknown, fallback: number, max: number) {
  if (value === undefined) return fallback
  if (
    typeof value !== 'string' ||
    !/^\d+$/.test(value) ||
    !Number.isSafeInteger(Number(value)) ||
    Number(value) < 1 ||
    Number(value) > max
  )
    throw new ListingApiError('Invalid pagination.', 400)
  return Number(value)
}

function stateIds(query: NextApiRequest['query']) {
  if (
    typeof query.ids !== 'string' ||
    query.page !== undefined ||
    query.pageSize !== undefined ||
    query.ids.length > 3700
  )
    throw new ListingApiError('Invalid Shop IDs.', 400)
  const ids = query.ids ? Array.from(new Set(query.ids.split(','))) : []
  if (ids.length > 100 || ids.some((id) => !shopUuid.test(id)))
    throw new ListingApiError('Invalid Shop IDs.', 400)
  return ids
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('Vary', 'Cookie')
  try {
    const segments = req.query.segments ?? []
    if (!Array.isArray(segments) || segments.length > 1)
      return res.status(404).json({ error: 'Not found.' })
    const methods = segments.length ? ['POST', 'DELETE'] : ['GET']
    if (!methods.includes(req.method || '')) {
      res.setHeader('Allow', methods.join(', '))
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    const keys = segments.length
      ? ['segments']
      : ['segments', 'ids', 'page', 'pageSize']
    if (Object.keys(req.query).some((k) => !keys.includes(k)))
      throw new ListingApiError('Invalid Shop favorite query.', 400)
    const repo = createShopFavoritesRepository({ req, res })
    if (segments.length) {
      requireSameOriginWrite(req)
      if (
        !shopUuid.test(segments[0]) ||
        (req.body &&
          (typeof req.body !== 'object' ||
            Array.isArray(req.body) ||
            Object.keys(req.body).length))
      )
        throw new ListingApiError('Invalid Shop favorite request.', 400)
      return res
        .status(200)
        .json(await repo.set(segments[0], req.method === 'POST'))
    }
    if (req.query.ids !== undefined) {
      return res.status(200).json(await repo.states(stateIds(req.query)))
    }
    return res.status(200).json(
      await repo.list({
        page: integer(req.query.page, 1, 1000),
        pageSize: integer(req.query.pageSize, 20, 100),
      })
    )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Shop favorites unavailable. Please retry.',
      })
  }
}
