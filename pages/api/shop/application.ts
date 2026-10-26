import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { createMarketplaceClient } from '@/lib/supabase/server'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (!['GET', 'POST'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    if (req.method === 'POST') {
      requireSameOriginWrite(req)
      if (
        !req.body ||
        typeof req.body !== 'object' ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length !== 0
      )
        throw new ListingApiError('A JSON object with no fields is required.')
      const { data, error } = await client.rpc(
        'marketplace_request_shop_application'
      )
      if (error)
        throw new ListingApiError(
          error.code === '42501'
            ? 'A verified email is required to apply for a Shop.'
            : 'Unable to submit Shop application.',
          error.code === '42501' ? 403 : 503
        )
      return res.status(200).json({ status: data })
    }
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
