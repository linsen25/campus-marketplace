import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { getOwnFinancialCapabilities } from '@/lib/server/financial-capabilities-service'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'GET')
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    // Query/body identities are intentionally never consumed.
    return res.status(200).json(await getOwnFinancialCapabilities({ req, res }))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to load financial capabilities.',
      })
  }
}
