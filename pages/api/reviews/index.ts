import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { createMarketplaceClient } from '@/lib/supabase/server'
import type { ReviewSubjectType } from '@/types/review'

const subjects: readonly ReviewSubjectType[] = [
  'resale_seller',
  'shop',
  'shop_product',
]
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60')
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed.' })
  }
  try {
    const { subjectType, subjectId, limit, before, beforeId } = req.query
    if (
      typeof subjectType !== 'string' ||
      !subjects.includes(subjectType as ReviewSubjectType) ||
      typeof subjectId !== 'string' ||
      !uuid.test(subjectId)
    )
      throw new ListingApiError('Invalid review subject.')
    const parsedLimit = limit === undefined ? 10 : Number(limit)
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 50)
      throw new ListingApiError('Invalid review page size.')
    if (
      (before !== undefined || beforeId !== undefined) &&
      (typeof before !== 'string' ||
        Number.isNaN(Date.parse(before)) ||
        typeof beforeId !== 'string' ||
        !uuid.test(beforeId))
    )
      throw new ListingApiError('Invalid review cursor.')
    const client = createMarketplaceClient({ req, res })
    const summary = await client.rpc('marketplace_get_review_summary', {
      p_subject_type: subjectType,
      p_subject_id: subjectId,
    })
    const page = await client.rpc('marketplace_get_public_reviews', {
      p_subject_type: subjectType,
      p_subject_id: subjectId,
      p_limit: parsedLimit,
      p_before: before || null,
      p_before_id: beforeId || null,
    })
    if (
      summary.error ||
      page.error ||
      !summary.data ||
      !Array.isArray(page.data)
    )
      throw new ListingApiError('Public reviews are unavailable.', 503)
    const reviews = page.data
    const last = reviews.at(-1) as
      | { reviewedAt?: unknown; reviewId?: unknown }
      | undefined
    const nextCursor =
      reviews.length === parsedLimit &&
      typeof last?.reviewedAt === 'string' &&
      typeof last?.reviewId === 'string'
        ? { reviewedAt: last.reviewedAt, reviewId: last.reviewId }
        : null
    return res.status(200).json({ reviews, summary: summary.data, nextCursor })
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 503)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Public reviews are unavailable.',
      })
  }
}
