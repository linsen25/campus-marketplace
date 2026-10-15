import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import {
  guardPlacesRate,
  requirePlacesEnvironment,
  searchPlaces,
  validatePlacesInput,
} from '@/lib/server/places-service'
import { createMarketplaceClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: { sizeLimit: '2kb' } } }
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!['autocomplete', 'details'].includes(String(req.query.action)))
    return res.status(404).json({ error: 'Not found.' })
  if (req.method !== 'POST')
    return res
      .status(405)
      .setHeader('Allow', 'POST')
      .json({ error: 'Method not allowed.' })
  try {
    requirePlacesEnvironment()
    requireSameOriginWrite(req)
    const action = req.query.action as 'autocomplete' | 'details'
    const input = validatePlacesInput(req.body, action)
    const actor = await requireMarketplaceUser(
      createMarketplaceClient({ req, res })
    )
    guardPlacesRate(actor.id)
    const result = await searchPlaces(action, input.value, input.sessionToken)
    return res
      .status(200)
      .json(action === 'autocomplete' ? { suggestions: result } : result)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Location search is temporarily unavailable.',
      })
  }
}
