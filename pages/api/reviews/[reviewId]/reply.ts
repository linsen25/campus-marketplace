import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    requireSameOriginWrite(req)
    const reviewId = req.query.reviewId
    const reply = req.body?.reply
    if (typeof reviewId !== 'string' || !uuid.test(reviewId))
      throw new ListingApiError('Invalid review ID.')
    if (
      typeof reply !== 'string' ||
      reply.trim().length < 1 ||
      reply.trim().length > 500
    )
      throw new ListingApiError('Reply must be between 1 and 500 characters.')
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(
      'marketplace_submit_review_reply',
      { p_review_id: reviewId, p_reply: reply.trim() }
    )
    if (error)
      throw new ListingApiError(
        error.code === '23505'
          ? 'A reply has already been submitted.'
          : 'Unable to submit review reply.',
        error.code === '42501' ? 403 : 409
      )
    return res.status(200).json(data)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to submit review reply.',
      })
  }
}
