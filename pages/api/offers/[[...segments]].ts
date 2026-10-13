import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { SellerPayoutNotReadyError } from '@/lib/order-payout-error'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createOffersService } from '@/lib/server/offers-service'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }
function validateBody(body: unknown, action: string) {
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new ListingApiError('JSON object required.')
  let allowed = [
    'clientActionId',
    'conversationId',
    'terms',
    'comparisonOfferId',
    'kind',
  ]
  if (action === 'accept') allowed = ['clientActionId']
  if (action === 'deny') allowed = ['clientActionId']
  if (action === 'withdraw') allowed = ['clientActionId', 'note']
  if (Object.keys(body).some((key) => !allowed.includes(key)))
    throw new ListingApiError('Offer identity and lifecycle are server-owned.')
}
// eslint-disable-next-line complexity -- Keep one authenticated dispatcher for context/history and three guarded mutations.
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const parts =
    typeof req.query.segments === 'string'
      ? [req.query.segments]
      : req.query.segments || []
  if (
    parts.length &&
    !(parts.length === 2 && ['withdraw', 'accept', 'deny'].includes(parts[1]))
  )
    return res.status(404).json({ error: 'Not found.' })
  if (
    !['GET', 'POST'].includes(req.method || '') ||
    (parts.length && req.method !== 'POST')
  )
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    if (req.method === 'POST') requireSameOriginWrite(req)
    const body = req.method === 'POST' ? req.body : {}
    validateBody(body, parts[1] || 'create')
    const service = createOffersService({ req, res })
    let result
    if (parts[1] === 'accept') result = await service.accept(parts[0], body)
    else if (req.method === 'GET')
      result = req.query.listingId
        ? await service.context(req.query.listingId)
        : await service.history(req.query.conversationId)
    else {
      let action: 'create' | 'deny' | 'withdraw' = 'create'
      if (parts.length) action = 'withdraw'
      if (parts[1] === 'deny') action = 'deny'
      result = await service.mutate(action, parts[0], body)
    }
    return res.status(200).json(result)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        ...(error instanceof SellerPayoutNotReadyError
          ? { code: error.code }
          : {}),
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to complete Offer.',
      })
  }
}
