import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { createMarketplaceClient } from '@/lib/supabase/server'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc(
      'marketplace_shop_application_status'
    )
    if (error)
      throw new ListingApiError('Unable to load Shop approval status.', 503)
    return res.status(200).json({ status: data })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to load Shop approval status.',
      })
  }
}
