// Server-only B28-B audit boundary. Values are deliberately projected before
// persistence so provider payloads, credentials and user data cannot enter it.
import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'

export type WorkerRuntimeStatus =
  | 'completed'
  | 'idle'
  | 'disabled'
  | 'busy'
  | 'degraded'
  | 'failed'

type WorkerRun = { acquired: boolean; runId?: string; token?: string }

export type WorkerCompletion = {
  status: WorkerRuntimeStatus
  processedCount: number
  retryCount: number
  needsAttentionCount: number
  skippedDueToLease: boolean
  budgetInterrupted: boolean
  errorCodes: string[]
  phases: Record<string, unknown>
}

async function rpc<T>(
  action: 'start' | 'finish',
  platform: string,
  token: string | null,
  value: Record<string, unknown>
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_worker_observability',
    {
      p_action: action,
      p_worker: 'stripe_worker',
      p_platform: platform,
      p_token: token,
      p_value: value,
    }
  )
  if (error) throw new ListingApiError('Worker audit is unavailable.', 503)
  return data as T
}

export function configuredStripeWorkerPlatform() {
  const platform = process.env.STRIPE_PLATFORM_ACCOUNT_ID || ''
  if (!/^acct_[A-Za-z0-9]+$/.test(platform))
    throw new ListingApiError('Worker audit is unavailable.', 503)
  return platform
}

export async function startStripeWorkerRun(platform: string, enabled: boolean) {
  return rpc<WorkerRun>('start', platform, null, {
    enabled,
    stage: 'dispatch',
  })
}

export async function finishStripeWorkerRun(
  platform: string,
  token: string,
  completion: WorkerCompletion
) {
  return rpc<Record<string, unknown>>('finish', platform, token, completion)
}
