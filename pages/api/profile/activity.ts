import type { NextApiRequest, NextApiResponse } from 'next'

import { validAccountActivity } from '@/lib/account-activity'
import type { ActivityPeriod, ActivityPoint } from '@/lib/account-activity'
import { ListingApiError } from '@/lib/listing-validation'
import { requireFinancialEnvironment } from '@/lib/server/financial-capabilities-service'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

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
    requireFinancialEnvironment()
    if (
      Object.keys(req.query).some((key) => key !== 'period') ||
      !['1D', '7D', '30D'].includes(String(req.query.period)) ||
      typeof req.query.period !== 'string'
    )
      throw new ListingApiError('Invalid activity period.')
    const period = req.query.period as ActivityPeriod
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    const { data, error } = await client.rpc('marketplace_account_activity', {
      p_period: period,
    })
    if (error || !validAccountActivity(data, period))
      throw new ListingApiError('Activity is unavailable. Please retry.', 503)
    return res.status(200).json({
      period: data.period,
      points: data.points.map((point: ActivityPoint) => ({
        timestamp: point.timestamp,
        label: point.label,
        views: point.views,
        listings: point.listings,
        sold: point.sold,
        overall: point.overall,
      })),
    })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({ error: 'Activity is unavailable. Please retry.' })
  }
}
