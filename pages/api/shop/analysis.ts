import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { createShopAnalysisRepository } from '@/lib/server/shop-analysis-repository'

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
    if (Object.keys(req.query).join(',') !== 'range')
      throw new ListingApiError('Provide only an analysis period.')
    return res
      .status(200)
      .json(
        await createShopAnalysisRepository({ req, res }).get(req.query.range)
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Shop analysis is unavailable. Please retry.',
      })
  }
}
