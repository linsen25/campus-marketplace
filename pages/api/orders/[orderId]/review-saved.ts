import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    const orderId = req.query.orderId
    if (typeof orderId !== 'string' || !uuid.test(orderId))
      throw new ListingApiError('Invalid order ID.')
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc('marketplace_get_order_reviews', {
      p_order_id: orderId,
    })
    if (error)
      throw new ListingApiError(
        error.code === 'PGRST202'
          ? 'Reviews are not available until the review service is deployed.'
          : 'Review history is unavailable.',
        error.code === '42501' ? 403 : 503
      )
    if (!Array.isArray(data))
      throw new ListingApiError('Review history is unavailable.', 503)
    return res.status(200).json(data)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Review history is unavailable.',
      })
  }
}
