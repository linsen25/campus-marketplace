import { timingSafeEqual } from 'crypto'

import type { NextApiRequest, NextApiResponse } from 'next'

import { drainShopSuspensionLifecycle } from '@/lib/server/shop-suspension-lifecycle'
import { drainStripeOperationalRecovery } from '@/lib/server/stripe-operational-recovery'
import {
  configuredStripeWorkerPlatform,
  finishStripeWorkerRun,
  startStripeWorkerRun,
} from '@/lib/server/worker-observability'

const scheduledBatchLimit = 2

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  res.setHeader('Cache-Control', 'no-store')
  res.setHeader('Allow', 'POST')
  if (req.method !== 'POST') return res.status(405).end()
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
  if (!authorized) return res.status(401).end()
  const enabled =
    process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED === 'true' ||
    process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED === 'true'
  let platform = ''
  let audit: { acquired: boolean; runId?: string; token?: string } | undefined
  try {
    platform = configuredStripeWorkerPlatform()
    audit = await startStripeWorkerRun(platform, enabled)
    if (!audit.acquired)
      return res.status(200).json({
        degraded: false,
        runtimeStatus: 'busy',
        batchLimit: scheduledBatchLimit,
      })
    if (!audit.token) throw new Error('Missing worker audit token.')
    const [recovery, shopLifecycle] = await Promise.allSettled([
      drainStripeOperationalRecovery(scheduledBatchLimit),
      drainShopSuspensionLifecycle(),
    ])
    const financial =
      recovery.status === 'fulfilled' ? recovery.value : undefined
    const shop =
      shopLifecycle.status === 'fulfilled' ? shopLifecycle.value : undefined
    const degraded = Boolean(
      recovery.status === 'rejected' ||
        shopLifecycle.status === 'rejected' ||
        financial?.degraded
    )
    const active = Boolean(
      (financial && financial.status !== 'disabled') || shop?.enabled
    )
    const runtimeStatus = degraded
      ? 'degraded'
      : financial?.status === 'busy' || shop?.busy
      ? 'busy'
      : !active
      ? 'disabled'
      : financial?.status === 'completed' ||
        financial?.status === 'needs_attention' ||
        (shop &&
          shop.offersClosed + shop.messagesInserted + shop.cyclesReopened > 0)
      ? 'completed'
      : 'idle'
    const financialProcessed = financial?.processed || 0
    const shopProcessed = shop
      ? shop.offersClosed + shop.messagesInserted + shop.cyclesReopened
      : 0
    const errorCodes = [
      ...(recovery.status === 'rejected'
        ? ['financial_coordinator_failed']
        : []),
      ...(shopLifecycle.status === 'rejected' ? ['shop_lifecycle_failed'] : []),
      ...(financial?.degraded ? ['financial_recovery_degraded'] : []),
    ]
    await finishStripeWorkerRun(platform, audit.token, {
      status: runtimeStatus,
      processedCount: financialProcessed + shopProcessed,
      retryCount: financial?.failedSteps || 0,
      needsAttentionCount:
        (financial?.status === 'needs_attention' ? 1 : 0) + errorCodes.length,
      skippedDueToLease: Boolean(financial?.status === 'busy' || shop?.busy),
      budgetInterrupted: false,
      errorCodes,
      phases: {
        financial: financial
          ? {
              status: financial.status,
              processed: financialProcessed,
              successfulSteps: financial.successfulSteps,
              failedSteps: financial.failedSteps,
            }
          : { status: 'failed' },
        shopLifecycle: shop
          ? {
              enabled: shop.enabled,
              busy: shop.busy,
              processed: shopProcessed,
            }
          : { status: 'failed' },
      },
    })
    return res.status(degraded ? 503 : 200).json({
      ...(financial || {
        status: 'runtime_error',
        degraded: true,
        successfulSteps: 0,
        failedSteps: 1,
      }),
      degraded,
      runtimeStatus,
      batchLimit: scheduledBatchLimit,
      shopLifecycle:
        shop ||
        ({
          enabled: process.env.SHOP_SUSPENSION_LIFECYCLE_ENABLED === 'true',
          unavailable: true,
        } as const),
    })
  } catch {
    if (audit?.acquired && audit.token && platform) {
      try {
        await finishStripeWorkerRun(platform, audit.token, {
          status: 'failed',
          processedCount: 0,
          retryCount: 0,
          needsAttentionCount: 1,
          skippedDueToLease: false,
          budgetInterrupted: false,
          errorCodes: ['worker_runtime_failed'],
          phases: { dispatch: { status: 'failed' } },
        })
      } catch {
        // An unavailable audit store leaves the receipt running. Its bounded
        // lease expires and the next start records interruption, never success.
      }
    }
    return res
      .status(503)
      .json({ error: 'Stripe reconciliation is unavailable.' })
  }
}
