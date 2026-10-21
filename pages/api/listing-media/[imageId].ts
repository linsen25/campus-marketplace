import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { readListingMedia } from '@/lib/server/listing-media'
import { createMarketplaceClient } from '@/lib/supabase/server'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store, max-age=0')
  res.setHeader('Vary', 'Cookie')
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  if (!['GET', 'HEAD'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, HEAD')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    const client = createMarketplaceClient({ req, res })
    const image = await readListingMedia(client, String(req.query.imageId))
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    res.setHeader('Content-Type', image.type)
    res.setHeader('Content-Length', image.body.length)
    res.status(200)
    return req.method === 'HEAD' ? res.end() : res.send(image.body)
  } catch (error) {
    res.setHeader('Cache-Control', 'private, no-store, max-age=0')
    const status = error instanceof ListingApiError ? error.status : 503
    return res.status(status).json({
      error: status === 404 ? 'Image not found.' : 'Image unavailable.',
    })
  }
}
