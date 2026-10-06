import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { marketTaxonomy } from '@/lib/market-taxonomy'
import { requireMarketplaceUser } from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

// Only category identifiers leave the database; no listing/user payloads or writes.
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
    await requireMarketplaceUser(client)
    const counts = new Map(Object.keys(marketTaxonomy).map((name) => [name, 0]))
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client
        .from('listings')
        .select('category')
        .eq('status', 'available')
        .not('published_at', 'is', null)
        .order('id')
        .range(offset, offset + 999)
      if (error || !data)
        throw new ListingApiError(
          'Marketplace trends are unavailable. Please retry.',
          503
        )
      for (const row of data) {
        // Persisted categories must match the canonical taxonomy. Fail closed
        // on schema drift rather than inventing or dropping counts.
        if (!counts.has(row.category))
          throw new ListingApiError(
            'Marketplace trends are unavailable. Please retry.',
            503
          )
        counts.set(row.category, counts.get(row.category)! + 1)
      }
      if (data.length < 1000) break
    }
    return res
      .status(200)
      .json(
        Array.from(counts, ([category, count]) => ({ category, count })).sort(
          (a, b) => b.count - a.count
        )
      )
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Marketplace trends are unavailable. Please retry.',
      })
  }
}
