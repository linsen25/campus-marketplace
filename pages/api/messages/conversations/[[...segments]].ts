import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createSupabaseMessagesRepository } from '@/lib/server/supabase-messages-repository'

export const config = { api: { bodyParser: { sizeLimit: '32kb' } } }
// eslint-disable-next-line complexity -- One dispatcher for the six Pages API operations.
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
    parts.length > 2 ||
    (parts.length === 2 && !['messages', 'read'].includes(parts[1]))
  )
    return res.status(404).json({ error: 'Not found.' })
  let allowed = ['GET', 'POST']
  if (parts[1] === 'read') allowed = ['POST']
  else if (parts.length === 1) allowed = ['GET']
  if (!allowed.includes(req.method || '')) {
    res.setHeader('Allow', allowed.join(', '))
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (req.method !== 'GET') requireSameOriginWrite(req)
    const repository = createSupabaseMessagesRepository({ req, res })
    await repository.authorize()
    if (
      req.method === 'POST' &&
      (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
    )
      throw new ListingApiError('A JSON object is required.')
    let result: unknown
    if (!parts.length) {
      if (req.method === 'POST')
        result = await repository.findOrCreate(req.body.listingId)
      else {
        if (
          typeof req.query.role !== 'string' ||
          (req.query.cursor !== undefined &&
            typeof req.query.cursor !== 'string')
        )
          throw new ListingApiError('Choose a single role and cursor.')
        result = await repository.list(req.query.role, req.query.cursor)
      }
    } else if (parts.length === 1) result = await repository.detail(parts[0])
    else if (parts[1] === 'read')
      result = await repository.read(parts[0], req.body.throughSequence)
    else if (req.method === 'POST')
      result = await repository.send(parts[0], req.body)
    else {
      if (
        req.query.before !== undefined &&
        (typeof req.query.before !== 'string' ||
          !/^\d+$/.test(req.query.before))
      )
        throw new ListingApiError('Invalid history cursor.')
      result = await repository.history(
        parts[0],
        req.query.before === undefined ? undefined : Number(req.query.before)
      )
    }
    return res.status(200).json(result)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to complete the Messages request.',
      })
  }
}
