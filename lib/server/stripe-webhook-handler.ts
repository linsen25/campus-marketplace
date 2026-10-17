import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { receiveStripeEvent } from '@/lib/server/stripe-setup'

export function stripeWebhookHandler(
  channel: 'account' | 'connected' | 'platform'
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    res.setHeader('Cache-Control', 'no-store')
    if (req.method !== 'POST') return res.status(405).end()
    try {
      const signature = req.headers['stripe-signature']
      if (typeof signature !== 'string' || signature.length > 2048)
        throw new ListingApiError('Invalid Stripe event.', 400)
      const buffers: Buffer[] = []
      let size = 0
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        size += buffer.length
        if (size > 262144) throw new ListingApiError('Event too large.', 413)
        buffers.push(buffer)
      }
      await receiveStripeEvent(Buffer.concat(buffers), signature, channel)
      // Durable inbox first; a separately authenticated worker applies events.
      return res.status(200).json({ received: true })
    } catch (error) {
      return res
        .status(error instanceof ListingApiError ? error.status : 503)
        .json({
          error:
            error instanceof ListingApiError
              ? error.message
              : 'Unable to record Stripe event.',
        })
    }
  }
}
