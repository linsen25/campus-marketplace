import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { OrderFinancialError } from '@/lib/order-financial-error'
import { requireFinancialEnvironment } from '@/lib/server/financial-capabilities-service'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { simulateOrderPaymentSuccess } from '@/lib/server/order-financial-service'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    requireFinancialEnvironment()
    if (req.method !== 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    requireSameOriginWrite(req)
    return res
      .status(200)
      .json(
        await simulateOrderPaymentSuccess(
          { req, res },
          req.query.orderId,
          req.body || {}
        )
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to complete test payment.',
        ...(error instanceof OrderFinancialError ? { code: error.code } : {}),
      })
  }
}
