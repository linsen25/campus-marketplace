import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { receiveShopBillingWebhook } from '@/lib/server/shop-billing-webhook'

export const config = { api: { bodyParser: false } }

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'POST') return res.status(405).end()
  try {
    const signature = req.headers['stripe-signature']
    if (typeof signature !== 'string')
      throw new ListingApiError('Invalid Stripe event.', 400)
    const chunks: Buffer[] = []
    let size = 0
    for await (const chunk of req) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.length
      if (size > 262144) throw new ListingApiError('Event too large.', 413)
      chunks.push(buffer)
    }
    return res
      .status(200)
      .json(await receiveShopBillingWebhook(Buffer.concat(chunks), signature))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Shop Billing webhook is unavailable.',
      })
  }
}
