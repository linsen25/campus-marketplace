import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createNotificationsService } from '@/lib/server/notifications-service'

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET' && req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    const service = createNotificationsService({ req, res })
    if (req.method === 'GET') {
      if (
        Object.keys(req.query).some(
          (key) => !['before', 'beforeId'].includes(key)
        )
      )
        throw new ListingApiError('Unexpected notification query.')
      return res
        .status(200)
        .json(await service.list(req.query.before, req.query.beforeId))
    }
    requireSameOriginWrite(req)
    if (
      !req.body ||
      Array.isArray(req.body) ||
      Object.keys(req.body).length !== 1 ||
      typeof req.body.id !== 'string'
    )
      throw new ListingApiError('Notification id required.')
    return res.status(200).json(await service.markRead(req.body.id))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to load notifications.',
      })
  }
}
