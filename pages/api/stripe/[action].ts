import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { stripeConfiguration } from '@/lib/server/stripe-environment'
import {
  reconcileStripe,
  startCardSetup,
  startPayoutSetup,
} from '@/lib/server/stripe-setup'
import { createMarketplaceClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } }
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  res.setHeader('Referrer-Policy', 'no-referrer')
  try {
    stripeConfiguration()
    const action = req.query.action
    if (
      Object.keys(req.query).some((key) => key !== 'action') ||
      typeof action !== 'string' ||
      !['card-setup', 'payout-setup', 'reconcile'].includes(action)
    )
      throw new ListingApiError('Not found.', 404)
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    requireSameOriginWrite(req)
    if (
      !req.body ||
      Array.isArray(req.body) ||
      typeof req.body !== 'object' ||
      Object.keys(req.body).some(
        (k) => action !== 'reconcile' || k !== 'kind'
      ) ||
      (req.body.kind !== undefined &&
        !['payment_method', 'payout_account'].includes(req.body.kind))
    )
      throw new ListingApiError('Unexpected setup fields.', 400)
    const user = await requireMarketplaceUser(
      createMarketplaceClient({ req, res })
    )
    if (action === 'card-setup')
      return res.status(200).json(await startCardSetup(user.id))
    if (action === 'payout-setup')
      return res.status(200).json(await startPayoutSetup(user.id))
    return res
      .status(200)
      .json(
        await reconcileStripe(
          user.id,
          req.body.kind ? [req.body.kind] : undefined
        )
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to prepare secure account setup. Please try again.',
      })
  }
}
