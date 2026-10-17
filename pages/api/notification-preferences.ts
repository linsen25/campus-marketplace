import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  notificationPreferenceKeys,
  validNotificationPreferences,
} from '@/lib/notification-preferences'
import { requireFinancialEnvironment } from '@/lib/server/financial-capabilities-service'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: { sizeLimit: '1kb' } } }
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!['GET', 'POST'].includes(req.method || ''))
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    requireFinancialEnvironment()
    if (Object.keys(req.query).length)
      throw new ListingApiError('Unexpected preference query.')
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    if (req.method === 'POST') {
      requireSameOriginWrite(req)
      if (
        !req.body ||
        Array.isArray(req.body) ||
        Object.keys(req.body).length !== 2 ||
        !notificationPreferenceKeys.includes(req.body.key) ||
        typeof req.body.value !== 'boolean'
      )
        throw new ListingApiError('Invalid notification preference.')
    }
    const { data, error } = await client.rpc(
      req.method === 'GET'
        ? 'marketplace_notification_preferences'
        : 'marketplace_set_notification_preference',
      req.method === 'GET'
        ? {}
        : { p_key: req.body.key, p_value: req.body.value }
    )
    if (error || !validNotificationPreferences(data))
      throw new ListingApiError(
        'Unable to update notification preferences. Please retry.',
        error?.code === '42501' ? 403 : 503
      )
    return res.status(200).json(data)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to load notification preferences. Please retry.',
      })
  }
}
