import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  getOwnFinancialCapabilities,
  recordFinancialCapability,
  requireFinancialEnvironment,
} from '@/lib/server/financial-capabilities-service'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    requireFinancialEnvironment()
    if (process.env.STRIPE_PROVIDER_ENABLED === 'true')
      throw new ListingApiError(
        'Staging simulation is disabled while Stripe setup is enabled.',
        503
      )
    if (req.method !== 'POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    requireSameOriginWrite(req)
    const user = await requireMarketplaceUser(
      createMarketplaceClient({ req, res })
    )
    const { capability, status } = req.body || {}
    let allowed: string[] = []
    if (capability === 'payment_method')
      allowed = ['unset', 'set', 'needs_attention']
    if (capability === 'payout_account')
      allowed = ['unset', 'ready', 'needs_attention']
    if (!allowed.includes(status))
      throw new ListingApiError('Invalid test state.', 400)
    // Ignore all supplied identities/references/metadata. Only safe fixed test metadata.
    await recordFinancialCapability(
      status === 'unset'
        ? { userId: user.id, capability, status }
        : {
            userId: user.id,
            capability,
            status,
            providerKey: 'staging_test',
            providerOwnerRef: `staging_test_owner_${user.id}`,
            providerInstrumentRef: `staging_test_${capability}_${user.id}`,
            displayLabel:
              capability === 'payment_method' ? 'Test Card' : 'Test Bank',
            last4: capability === 'payment_method' ? '4242' : '6789',
          }
    )
    return res.status(200).json(await getOwnFinancialCapabilities({ req, res }))
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to update test state.',
      })
  }
}
