import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createOrderDomainService } from '@/lib/server/order-domain-service'

export const config = { api: { bodyParser: { sizeLimit: '8kb' } } }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (!['GET', 'POST'].includes(req.method || ''))
    return res.status(405).json({ error: 'Method not allowed.' })
  if (typeof req.query.operation !== 'string')
    return res.status(404).json({ error: 'Not found.' })
  try {
    const service = createOrderDomainService({ req, res })
    if (req.method === 'POST') {
      requireSameOriginWrite(req)
      return res
        .status(200)
        .json(
          await service.write(req.query.id, req.query.operation, req.body || {})
        )
    }
    return res
      .status(200)
      .json(await service.read(req.query.id, req.query.operation))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Order operation unavailable.',
      })
  }
}
