import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireFinancialEnvironment } from '@/lib/server/financial-capabilities-service'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { messageUuid } from '@/lib/server/messages-environment'
import { createMarketplaceClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } }

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
    requireFinancialEnvironment()
    requireSameOriginWrite(req)
    if (
      Object.keys(req.query).length ||
      !req.body ||
      Array.isArray(req.body) ||
      Object.keys(req.body).sort().join(',') !== 'eventId,shopId'
    )
      throw new ListingApiError('Invalid view.')
    const shopId = messageUuid(req.body.shopId)
    const eventId = messageUuid(req.body.eventId)
    const client = createMarketplaceClient({ req, res })
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser()
    if (authError && authError.name !== 'AuthSessionMissingError')
      throw new ListingApiError('Unable to validate session.', 401)
    if (!user) return res.status(200).json({ recorded: false })
    const { data, error } = await client.rpc('marketplace_record_shop_view', {
      p_shop_id: shopId,
      p_event_id: eventId,
    })
    if (error || typeof data?.recorded !== 'boolean')
      throw new ListingApiError('Unable to record view.', 503)
    return res.status(200).json({ recorded: data.recorded })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({ error: 'Unable to record view.' })
  }
}
