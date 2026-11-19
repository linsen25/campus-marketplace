import type { NextApiRequest, NextApiResponse } from 'next'

import { isWithinWesternCampus } from '@/lib/geo/western-campus'
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
  if (
    !['autocomplete', 'details', 'validate'].includes(String(req.query.action))
  )
    return res.status(404).json({ error: 'Not found.' })
  if (req.method !== 'POST')
    return res
      .status(405)
      .setHeader('Allow', 'POST')
      .json({ error: 'Method not allowed.' })
  try {
    requirePlacesEnvironment()
    requireSameOriginWrite(req)

    const action = req.query.action as 'autocomplete' | 'details' | 'validate'

    const actor = await requireMarketplaceUser(
      createMarketplaceClient({ req, res })
    )
    guardPlacesRate(actor.id)

    if (action === 'validate') {
      const body = req.body

      if (
        !body ||
        typeof body !== 'object' ||
        Array.isArray(body) ||
        Object.keys(body).some(
          (key) => !['placeId', 'sessionToken', 'meetingArea'].includes(key)
        ) ||
        (body.meetingArea !== 'ON_CAMPUS' && body.meetingArea !== 'OTHER')
      ) {
        throw new ListingApiError('Invalid location validation request.', 400)
      }

      const input = validatePlacesInput(
        {
          placeId: body.placeId,
          sessionToken: body.sessionToken,
        },
        'details'
      )

      const place = await searchPlaces(
        'details',
        input.value,
        input.sessionToken,
        fetch,
        true
      )

      if (Array.isArray(place)) {
        throw new ListingApiError('Location validation unavailable.', 503)
      }

      const withinCampus = place.location
        ? isWithinWesternCampus(
            place.location.latitude,
            place.location.longitude
          )
        : null

      const valid =
        place.placeId === input.value &&
        withinCampus !== null &&
        (body.meetingArea === 'ON_CAMPUS' ? withinCampus : !withinCampus)

      return res.status(200).json({ valid })
    }

    const input = validatePlacesInput(req.body, action)

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
