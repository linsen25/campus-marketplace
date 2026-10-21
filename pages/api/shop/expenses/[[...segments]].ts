import type { NextApiRequest, NextApiResponse } from 'next'

import { ListingApiError } from '@/lib/listing-validation'
import { requireSameOriginWrite } from '@/lib/server/marketplace-auth'
import { createShopCostsRepository } from '@/lib/server/shop-costs-repository'

export const config = { api: { bodyParser: { sizeLimit: '4kb' } } }
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    const parts = req.query.segments ?? []
    if (
      !Array.isArray(parts) ||
      parts.length > 1 ||
      Object.keys(req.query).some((k) => !['segments', 'beforeId'].includes(k))
    )
      throw new ListingApiError('Invalid expense request.')
    const allowed = parts.length ? ['PATCH', 'DELETE'] : ['GET', 'POST']
    if (!allowed.includes(req.method || '')) {
      res.setHeader('Allow', allowed.join(', '))
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    if (
      req.query.beforeId !== undefined &&
      (parts.length || req.method !== 'GET')
    )
      throw new ListingApiError('Invalid expense cursor.')
    if (req.method !== 'GET') requireSameOriginWrite(req)
    const repository = createShopCostsRepository({ req, res })
    let action: 'create' | 'delete' | 'update' = 'delete'
    if (req.method === 'POST') action = 'create'
    if (req.method === 'PATCH') action = 'update'
    const result =
      req.method === 'GET'
        ? await repository.expenses(req.query.beforeId)
        : await repository.saveExpense(action, req.body, parts[0])
    return res.status(req.method === 'POST' ? 201 : 200).json(result)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Private Shop records unavailable.',
      })
  }
}
