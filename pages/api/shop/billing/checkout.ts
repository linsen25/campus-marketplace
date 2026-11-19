import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { startShopBillingCheckout } from '@/lib/server/shop-billing-checkout'

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (Object.keys(req.query).length)
      throw new ListingApiError('Not found.', 404)
    requireSameOriginWrite(req)
    return res
      .status(200)
      .json(await startShopBillingCheckout({ req, res }, req.body))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Shop Billing checkout is unavailable.',
      })
  }
}
