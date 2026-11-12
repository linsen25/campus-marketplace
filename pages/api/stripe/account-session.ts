import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { startEmbeddedPayoutSetup } from '@/lib/server/stripe-setup'
import { stripeConfiguration } from '@/lib/server/stripe-environment'
import { createMarketplaceClient } from '@/lib/supabase/server'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  try {
    stripeConfiguration()
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    requireSameOriginWrite(req)
    if (
      !req.body ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== 'mode') ||
      (req.body.mode !== undefined &&
        !['onboarding', 'management'].includes(req.body.mode))
    )
      throw new ListingApiError('Unexpected setup fields.', 400)
    const user = await requireMarketplaceUser(
      createMarketplaceClient({ req, res })
    )
    return res
      .status(200)
      .json(
        await startEmbeddedPayoutSetup(user.id, req.body.mode || 'onboarding')
      )
  } catch (error) {
    if (!(error instanceof ListingApiError)) {
      const provider = error as {
        type?: unknown
        code?: unknown
        statusCode?: unknown
        requestId?: unknown
        message?: unknown
      }
      // Keep provider diagnostics server-side and never echo secrets or URLs.
      console.error('Stripe embedded account session failed', {
        type: typeof provider.type === 'string' ? provider.type : undefined,
        code: typeof provider.code === 'string' ? provider.code : undefined,
        statusCode:
          typeof provider.statusCode === 'number'
            ? provider.statusCode
            : undefined,
        requestId:
          typeof provider.requestId === 'string'
            ? provider.requestId
            : undefined,
        message:
          typeof provider.message === 'string'
            ? provider.message.slice(0, 240)
            : undefined,
      })
    }
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to prepare secure payout setup. Please try again.',
      })
  }
}
