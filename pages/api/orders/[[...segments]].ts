import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createOrdersService } from '@/lib/server/orders-service'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }

// Route/method/CSRF guards stay together for this bounded action surface.
// eslint-disable-next-line complexity
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const parts =
    typeof req.query.segments === 'string'
      ? [req.query.segments]
      : req.query.segments || []
  const campus =
    parts.length === 3 &&
    ((parts[1] === 'inspection' && parts[2] === 'confirm') ||
      (parts[1] === 'payment' && parts[2] === 'start'))
  const cancelling = parts.length === 2 && parts[1] === 'cancel'
  const proposing =
    parts.length === 3 && parts[1] === 'meetup' && parts[2] === 'proposals'
  const deciding =
    parts.length === 5 &&
    parts[1] === 'meetup' &&
    parts[2] === 'proposals' &&
    ['confirm', 'decline', 'withdraw'].includes(parts[4])
  const meetup = proposing || deciding
  if (parts.length > 1 && !cancelling && !meetup && !campus)
    return res.status(404).json({ error: 'Not found.' })
  if (req.method !== (cancelling || meetup || campus ? 'POST' : 'GET'))
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    const service = createOrdersService({ req, res })
    if (campus) {
      requireSameOriginWrite(req)
      return res
        .status(200)
        .json(
          await service.campusAction(
            parts[0],
            parts[1] as 'inspection' | 'payment',
            req.body || {}
          )
        )
    }
    if (meetup) {
      requireSameOriginWrite(req)
      return res
        .status(200)
        .json(
          await service.meetupAction(
            parts[0],
            proposing ? 'propose' : parts[4],
            parts[3],
            req.body || {}
          )
        )
    }
    if (cancelling) {
      requireSameOriginWrite(req)
      return res
        .status(200)
        .json(await service.cancel(parts[0], req.body || {}))
    }
    return res
      .status(200)
      .json(
        parts.length
          ? await service.detail(parts[0])
          : await service.workspace(req.query.workspace)
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to load Orders.',
      })
  }
}
