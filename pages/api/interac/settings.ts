import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { normalizeInteracEmail } from '@/lib/interac-email'
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
    const client = createMarketplaceClient({ req, res })
    const user = await requireMarketplaceUser(client)
    if (req.method === 'GET') {
      const { data, error } = await client.rpc(
        'marketplace_get_interac_receiving_email_status'
      )
      if (error) {
        // B32 migration 007 is forward-only; keep the API readable while an
        // isolated database is still at migration 006.
        if (error.code !== '42883')
          throw new ListingApiError('Unable to load Interac settings.', 503)
        const legacy = await client.rpc(
          'marketplace_get_interac_receiving_email'
        )
        if (legacy.error)
          throw new ListingApiError('Unable to load Interac settings.', 503)
        return res.status(200).json({
          receivingEmail: legacy.data || null,
          verified: false,
          accountEmail: user.email,
          verificationPendingMigration: true,
        })
      }
      return res.status(200).json({
        receivingEmail: data?.email || null,
        verified: Boolean(data?.verified),
        accountEmail: user.email,
      })
    }
    if (req.method !== 'PUT' && req.method !== 'DELETE') {
      res.setHeader('Allow', 'GET, PUT, DELETE')
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    requireSameOriginWrite(req)
    const email =
      req.method === 'DELETE'
        ? ''
        : normalizeInteracEmail(req.body?.receivingEmail)
    if (req.method === 'PUT' && !email)
      throw new ListingApiError('Enter a valid Interac receiving email.')
    const { data, error } = await client.rpc(
      'marketplace_set_interac_receiving_email',
      {
        p_email: email || '',
      }
    )
    if (error)
      throw new ListingApiError(
        ['22023', '42501'].includes(error.code)
          ? error.message
          : 'Unable to save Interac settings.',
        400
      )
    return res.status(200).json({
      receivingEmail: data || null,
      verified: Boolean(
        data && user.email && data.toLowerCase() === user.email.toLowerCase()
      ),
      accountEmail: user.email,
    })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to update Interac settings.',
      })
  }
}
