import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

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
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    const orderId = typeof req.query.id === 'string' ? req.query.id : ''
    if (!/^[0-9a-f-]{36}$/i.test(orderId))
      throw new ListingApiError('Invalid order.')
    const { data, error } = await client.rpc(
      'marketplace_get_order_interac_email',
      {
        p_order_id: orderId,
      }
    )
    if (error)
      throw new ListingApiError('Unable to load the receiving email.', 503)
    return res.status(200).json({ receivingEmail: data || null })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to load the receiving email.',
      })
  }
}
