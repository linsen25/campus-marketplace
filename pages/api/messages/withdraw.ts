import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createSupabaseMessagesRepository } from '@/lib/server/supabase-messages-repository'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  try {
    requireSameOriginWrite(req)
    if (
      !req.body ||
      typeof req.body !== 'object' ||
      Array.isArray(req.body) ||
      Object.keys(req.body).some((key) => key !== 'messageId')
    )
      throw new ListingApiError('Provide an own message ID only.')
    const result = await createSupabaseMessagesRepository({
      req,
      res,
    }).withdraw(req.body.messageId)
    return res.status(200).json(result)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Unable to withdraw message.',
      })
  }
}
