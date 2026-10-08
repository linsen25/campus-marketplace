import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { uploadMessageImage } from '@/lib/server/message-image-service'
import { messageUuid } from '@/lib/server/supabase-messages-repository'
import { createMarketplaceClient } from '@/lib/supabase/server'

export const config = { api: { bodyParser: false } }
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 55000)
  const disconnected = () => controller.abort()
  const closed = () => {
    if (!res.writableEnded) controller.abort()
  }
  req.once('aborted', disconnected)
  res.once('close', closed)
  try {
    requireSameOriginWrite(req)
    const client = createMarketplaceClient({ req, res }, (input, options) =>
      fetch(input, { ...options, signal: controller.signal })
    )
    const result = await uploadMessageImage(
      client,
      req,
      messageUuid(req.query.submissionId),
      messageUuid(req.query.imageId),
      controller
    )
    return res.status(200).json(result)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Upload could not be confirmed. Retry the same submission.',
      })
  } finally {
    clearTimeout(timer)
    req.removeListener('aborted', disconnected)
    res.removeListener('close', closed)
  }
}
