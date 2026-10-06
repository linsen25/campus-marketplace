import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

// Own-account read only. No password fields, tokens, metadata or mutation path.
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
    const client = createMarketplaceClient({ req, res })
    const user = await requireMarketplaceUser(client)
    const { data, error } = await client
      .from('profiles')
      .select('username')
      .eq('id', user.id)
      .single()
    if (error || !data)
      throw new ListingApiError('Unable to load your account information.', 503)
    return res.status(200).json({
      username: data.username,
      email: user.email,
      emailVerified: Boolean(user.email_confirmed_at),
      createdAt: user.created_at,
      // No read-only canonical next-change timestamp RPC exists yet.
      nextUsernameChangeAt: null,
    })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to load your account information.',
      })
  }
}
