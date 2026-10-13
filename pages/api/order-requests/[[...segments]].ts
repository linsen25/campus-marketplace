import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { SellerPayoutNotReadyError } from '@/lib/order-payout-error'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createOrderRequestService } from '@/lib/server/order-request-service'
import { createOrdersService } from '@/lib/server/orders-service'

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } }
function requestBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ListingApiError('JSON object required.')
  const identityKeys = [
    'protocol_version',
    'protocolVersion',
    'sender_user_id',
    'senderId',
    'recipient_user_id',
    'recipientId',
  ]
  if (
    identityKeys.some((key) => Object.prototype.hasOwnProperty.call(value, key))
  )
    throw new ListingApiError('Proposal identity is server-owned.')
  return value as Record<string, unknown>
}
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const parts =
    typeof req.query.segments === 'string'
      ? [req.query.segments]
      : req.query.segments || []
  const validPath =
    !parts.length ||
    (parts.length === 2 && ['replace', 'cancel', 'accept'].includes(parts[1]))
  if (!validPath) return res.status(404).json({ error: 'Not found.' })
  if (
    !['GET', 'POST'].includes(req.method || '') ||
    (parts.length && req.method !== 'POST')
  )
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    if (req.method === 'POST') requireSameOriginWrite(req)
    const body = req.method === 'POST' ? requestBody(req.body) : {}
    if (parts[1] === 'accept') {
      return res
        .status(200)
        .json(await createOrdersService({ req, res }).accept(parts[0], body))
    }
    const service = createOrderRequestService({ req, res })
    if (req.method === 'GET')
      return res
        .status(200)
        .json(await service.history(req.query.conversationId))
    return res
      .status(200)
      .json(await service.mutate(parts[1] || 'create', parts[0], body))
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
            : 'Unable to complete Order Request.',
      })
  }
}
