import type { NextApiRequest, NextApiResponse } from 'next'
import { ListingApiError } from '@/lib/listing-validation'
import {
  requireMarketplaceUser,
  requireSameOriginWrite,
} from '@/lib/server/marketplace-auth'
import { createMarketplaceClient } from '@/lib/supabase/server'

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[4][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'private, no-store')
  try {
    if (typeof req.query.id !== 'string' || !uuid.test(req.query.id))
      throw new ListingApiError('Invalid order ID.')
    const client = createMarketplaceClient({ req, res })
    await requireMarketplaceUser(client)
    if (req.method === 'GET') {
      const { data, error } = await client.rpc(
        'marketplace_interac_payment_state',
        { p_order_id: req.query.id }
      )
      if (error)
        throw new ListingApiError(
          error.code === '42501'
            ? 'Order access denied.'
            : 'Unable to load Interac payment state.',
          error.code === '42501' ? 403 : 503
        )
      return res.status(200).json(data)
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST')
      return res.status(405).json({ error: 'Method not allowed.' })
    }
    requireSameOriginWrite(req)
    const action = req.body?.action
    const rpc =
      action === 'report'
        ? 'marketplace_report_interac_payment'
        : action === 'confirm-receipt'
        ? 'marketplace_confirm_interac_receipt'
        : null
    if (!rpc) throw new ListingApiError('Invalid Interac payment action.')
    const params =
      action === 'report'
        ? {
            p_order_id: req.query.id,
            p_reference:
              typeof req.body?.reference === 'string'
                ? req.body.reference
                : null,
          }
        : { p_order_id: req.query.id }
    const { data, error } = await client.rpc(rpc, params)
    if (error)
      throw new ListingApiError(
        error.code === '42501'
          ? error.message
          : error.code === '23505'
          ? 'Buyer payment report required.'
          : 'Unable to update Interac payment state.',
        error.code === '42501' ? 403 : error.code === '23505' ? 409 : 400
      )
    return res.status(200).json(data)
  } catch (error) {
    return res
      .status(error instanceof ListingApiError ? error.status : 500)
      .json({
        error:
          error instanceof ListingApiError
            ? error.message
            : 'Interac payment request failed.',
      })
  }
}
