import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { avatarUuid } from '@/lib/profile-avatar'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { requireAvatarEnvironment } from '@/lib/server/profile-avatar-repository'
import { readAvatar, saveAvatar } from '@/lib/server/profile-avatar-service'
import { createMarketplaceClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: false } }
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    requireSameOriginWrite(req)
    requireAvatarEnvironment()
    const user = await requireMarketplaceUser(
      createMarketplaceClient({ req, res })
    )
    const action = req.headers['x-avatar-action']
    const expected = req.headers['x-avatar-version']
    if (
      Object.keys(req.query).length ||
      typeof action !== 'string' ||
      !avatarUuid.test(action) ||
      typeof expected !== 'string' ||
      (expected !== 'none' && !avatarUuid.test(expected))
    )
      throw new ListingApiError('Invalid avatar request.', 400)
    const image = await readAvatar(req)
    return res
      .status(200)
      .json(
        await saveAvatar(
          user.id,
          action.toLowerCase(),
          expected === 'none' ? null : expected.toLowerCase(),
          image
        )
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to save your avatar. Please retry.',
      })
  }
}
