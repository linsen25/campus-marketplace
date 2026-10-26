import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import {
  completeUwoVerification,
  sendUwoVerification,
  uwoVerificationStatus,
} from '@/lib/server/uwo-verification'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    if (req.method === 'GET')
      return res.status(200).json(await uwoVerificationStatus({ req, res }))
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    requireSameOriginWrite(req)
    if (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))
      throw new ListingApiError('A JSON object is required.')
    if (req.body.action === 'send')
      return res
        .status(200)
        .json(await sendUwoVerification({ req, res }, req.body.email))
    if (req.body.action === 'verify')
      return res
        .status(200)
        .json(await completeUwoVerification({ req, res }, req.body.code))
    throw new ListingApiError('Choose a verification action.')
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'UWO verification is temporarily unavailable.',
      })
  }
}
