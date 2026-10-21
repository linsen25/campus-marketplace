import { timingSafeEqual } from 'crypto'

import type { NextApiRequest, NextApiResponse } from 'next'

import { drainStripeOrderPayments } from '@/lib/server/stripe-order-reconciliation'
import { drainStripeOrderRefundWork } from '@/lib/server/stripe-order-refund'
import { drainStripeEvents } from '@/lib/server/stripe-setup'

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  const expected = process.env.STRIPE_WORKER_SECRET || ''
  const actual =
    typeof req.headers.authorization === 'string'
      ? req.headers.authorization
      : ''
  const expectedBytes = Buffer.from(`Bearer ${expected}`)
  const actualBytes = Buffer.from(actual)
  const authorized =
    expected.length >= 32 &&
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  if (req.method !== 'POST' || !authorized) return res.status(403).end()
  try {
    const setup = await drainStripeEvents()
    const orderPayments = await drainStripeOrderPayments()
    const orderRefunds = await drainStripeOrderRefundWork()
    return res.status(200).json({
      processed:
        setup.processed +
        orderPayments.processed +
        orderRefunds.events.processed +
        orderRefunds.refunds.processed,
      setup,
      orderPayments,
      orderRefunds,
    })
  } catch {
    return res
      .status(503)
      .json({ error: 'Stripe reconciliation is unavailable.' })
  }
}
