import type { NextApiRequest, NextApiResponse } from 'next'

import { favoriteListingQuery } from '@/lib/favorites-api'
import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createSupabaseListingsRepository } from '@/lib/server/supabase-listings-repository'
import { queryFromRequest } from '@/pages/api/listings/[[...segments]]'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  const segments = req.query.segments || []
  const parts = Array.isArray(segments) ? segments : [segments]
  if (parts.length > 1) return res.status(404).json({ error: 'Not found.' })
  const allowed = parts.length ? ['GET', 'POST', 'DELETE'] : ['GET']
  if (!allowed.includes(req.method || '')) {
    res.setHeader('Allow', allowed.join(', '))
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (req.method !== 'GET') requireSameOriginWrite(req)
    const repository = createSupabaseListingsRepository({ req, res })
    if (!parts.length) {
      const query = queryFromRequest(req)
      if (req.query.place !== undefined) {
        if (typeof req.query.place !== 'string')
          throw new ListingApiError('Use a single Place value.')
        if (query.pickupArea && query.pickupArea !== req.query.place)
          throw new ListingApiError('Conflicting Place values.')
        query.pickupArea = req.query.place
      }
      // Accept the existing Market UI's sort identifiers without changing its controls.
      const sort = req.query.sort
      if (sort === 'price-asc') query.sort = 'price-low'
      if (sort === 'price-desc') query.sort = 'price-high'
      return res
        .status(200)
        .json(await repository.getFavoriteListings(favoriteListingQuery(query)))
    }
    return res
      .status(200)
      .json(
        req.method === 'GET'
          ? await repository.favoriteState(parts[0])
          : await repository.setFavorite(parts[0], req.method === 'POST')
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to complete the favorites request.',
      })
  }
}
