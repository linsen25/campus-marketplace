import type { NextApiRequest, NextApiResponse } from 'next'

import { normalizeInteracEmail } from '@/lib/interac-email'
import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

type InteracStatus = {
  email?: unknown
  verified?: unknown
}

function response(status: InteracStatus | null) {
  return {
    receivingEmail: typeof status?.email === 'string' ? status.email : null,
    verified: status?.verified === true,
  }
}

/** Owner-only receiving-email settings. No payment confirmation is implied. */
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (!['GET', 'PUT'].includes(req.method || '')) {
    res.setHeader('Allow', 'GET, PUT')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    if (req.method === 'PUT') requireSameOriginWrite(req)
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    if (req.method === 'GET') {
      const { data, error } = await client.rpc(
        'marketplace_get_interac_receiving_email_status'
      )
      if (error)
        throw new ListingApiError('Unable to load e-Transfer settings.', 503)
      return res.status(200).json(response(data as InteracStatus | null))
    }
    const email = normalizeInteracEmail(req.body?.receivingEmail)
    if (!email)
      throw new ListingApiError('Enter a valid e-Transfer receiving email.')
    const { data, error } = await client.rpc(
      'marketplace_set_interac_receiving_email',
      { p_email: email }
    )
    if (error)
      throw new ListingApiError(
        ['22023', '42501'].includes(error.code)
          ? error.message
          : 'Unable to save e-Transfer settings.',
        ['22023', '42501'].includes(error.code) ? 400 : 503
      )
    const { data: status, error: statusError } = await client.rpc(
      'marketplace_get_interac_receiving_email_status'
    )
    if (statusError)
      throw new ListingApiError('Unable to confirm e-Transfer settings.', 503)
    return res.status(200).json(
      response({
        ...(status as InteracStatus | null),
        email: typeof data === 'string' ? data : undefined,
      })
    )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to update e-Transfer settings.',
      })
  }
}
