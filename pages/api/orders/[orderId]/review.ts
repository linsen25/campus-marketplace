import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { ReviewSubjectType } from '@/types/review'

const subjects: readonly ReviewSubjectType[] = [
  'resale_seller',
  'shop',
  'shop_product',
]

function subject(value: unknown): ReviewSubjectType {
  if (
    typeof value !== 'string' ||
    !subjects.includes(value as ReviewSubjectType)
  )
    throw new ListingApiError('Choose a valid review subject.')
  return value as ReviewSubjectType
}

function uuid(value: unknown, field: string) {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value
    )
  )
    throw new ListingApiError(`Invalid ${field}.`)
  return value
}

function unavailable(error: unknown) {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: unknown }).code)
      : ''
  if (code === 'PGRST202')
    return new ListingApiError(
      'Reviews are not available until the review service is deployed.',
      503
    )
  return error
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    const orderId = uuid(req.query.orderId, 'order ID')
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    if (req.method === 'GET') {
      const reviewSubject = subject(req.query.subjectType)
      const { data, error } = await client.rpc(
        'marketplace_review_eligibility',
        {
          p_order_id: orderId,
          p_subject_type: reviewSubject,
        }
      )
      if (error) throw unavailable(error)
      if (!data || typeof data !== 'object')
        throw new ListingApiError('Review eligibility is unavailable.', 503)
      return res.status(200).json(data)
    }
    if (req.method === 'POST') {
      requireSameOriginWrite(req)
      const body = req.body && typeof req.body === 'object' ? req.body : null
      if (!body || Array.isArray(body))
        throw new ListingApiError('Provide a valid review.')
      const reviewSubject = subject(body.subjectType)
      const ratingUnits = body.ratingUnits
      if (!Number.isInteger(ratingUnits) || ratingUnits < 1 || ratingUnits > 10)
        throw new ListingApiError('Choose a rating between 0.5 and 5.0.')
      const comment = typeof body.comment === 'string' ? body.comment : ''
      if (comment.length > 500)
        throw new ListingApiError('Review text must be at most 500 characters.')
      if (
        !Array.isArray(body.quickTags) ||
        body.quickTags.length > 8 ||
        body.quickTags.some(
          (tag: unknown) =>
            typeof tag !== 'string' || !tag.trim() || tag.trim().length > 64
        )
      )
        throw new ListingApiError('Choose valid review tags.')
      const quickTags = body.quickTags as string[]
      const actionId = uuid(body.actionId, 'review action ID')
      const { data, error } = await client.rpc(
        'marketplace_submit_order_review',
        {
          p_order_id: orderId,
          p_subject_type: reviewSubject,
          p_rating_units: ratingUnits,
          p_comment: comment,
          p_quick_tags: quickTags.map((tag: string) => tag.trim()),
          p_action_id: actionId,
        }
      )
      if (error) throw unavailable(error)
      if (!data || typeof data !== 'object')
        throw new ListingApiError('Review submission is unavailable.', 503)
      return res.status(200).json(data)
    }
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ error: 'Method not allowed.' })
  } catch (error) {
    const status = error instanceof ListingApiError ? error.status : 503
    return res.status(status).json({
      error:
        error instanceof ListingApiError
          ? error.message
          : 'Review service unavailable. Please retry.',
    })
  }
}
