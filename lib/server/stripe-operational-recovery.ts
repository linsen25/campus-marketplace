// Server-only B25-C coordinator. It adds no provider mutation capability.
import { ListingApiError } from '@/lib/listing-validation'
import { createTrustedFinancialClient } from '@/lib/server/financial-capabilities-service'
import { drainStripeConnectedPayoutObservations } from '@/lib/server/stripe-connected-payout'
import { drainStripeOrderDisputes } from '@/lib/server/stripe-order-dispute'
import { drainStripeOrderPayments } from '@/lib/server/stripe-order-reconciliation'
import { drainStripeOrderRefundWork } from '@/lib/server/stripe-order-refund'
import { drainStripeOrderTransferWork } from '@/lib/server/stripe-order-transfer'
import { stripeRuntime } from '@/lib/server/stripe-runtime'
import { drainStripeEvents } from '@/lib/server/stripe-setup'

type StepName =
  | 'setup'
  | 'orderPayments'
  | 'orderDisputes'
  | 'orderRefunds'
  | 'orderTransfers'
  | 'connectedPayouts'

type StepResult =
  | {
      ok: true
      status: 'completed' | 'disabled' | 'idle' | 'needs_attention'
      value: Record<string, unknown>
    }
  | {
      ok: false
      status: 'configuration_missing' | 'retryable_failure'
      errorCode: string
    }

const failures: Record<StepName, string> = {
  setup: 'setup_failed',
  orderPayments: 'order_payments_failed',
  orderDisputes: 'order_disputes_failed',
  orderRefunds: 'order_refunds_failed',
  orderTransfers: 'order_transfers_failed',
  connectedPayouts: 'connected_payouts_failed',
}

async function recoveryRpc<T>(
  action: 'finish' | 'start' | 'summary' | 'sweep',
  platform: string,
  token: string | null = null,
  value: Record<string, unknown> = {}
) {
  const { data, error } = await createTrustedFinancialClient().rpc(
    'marketplace_operational_recovery',
    {
      p_action: action,
      p_platform: platform,
      p_token: token,
      p_value: value,
    }
  )
  if (error)
    throw new ListingApiError('Operational recovery is unavailable.', 503)
  return data as T
}

async function runStep(
  name: StepName,
  action: () => Promise<Record<string, unknown>>
): Promise<StepResult> {
  try {
    const value = await action()
    return { ok: true, status: stepStatus(value), value }
  } catch (error) {
    return {
      ok: false,
      status:
        error instanceof ListingApiError &&
        error.message ===
          'Secure account setup is unavailable. Please try again later.'
          ? 'configuration_missing'
          : 'retryable_failure',
      errorCode: failures[name],
    }
  }
}

function numericTotal(value: unknown, keys: ReadonlySet<string>): number {
  if (!value || typeof value !== 'object') return 0
  return Object.entries(value as Record<string, unknown>).reduce(
    (total, [key, item]) =>
      total +
      (typeof item === 'number' && keys.has(key)
        ? item
        : numericTotal(item, keys)),
    0
  )
}

const workKeys = new Set([
  'processed',
  'recovered',
  'prepared',
  'synced',
  'scanned',
])
const attentionKeys = new Set(['exceptions', 'mismatches', 'retried'])

function stepStatus(value: Record<string, unknown>) {
  if (value.enabled === false) return 'disabled' as const
  if (numericTotal(value, attentionKeys) > 0) return 'needs_attention' as const
  return numericTotal(value, workKeys) > 0
    ? ('completed' as const)
    : ('idle' as const)
}

function processed(result: StepResult) {
  if (!result.ok) return 0
  const value = result.value
  if (typeof value.processed === 'number') return value.processed
  return Object.values(value).reduce<number>((total, item) => {
    if (!item || typeof item !== 'object') return total
    const count = (item as Record<string, unknown>).processed
    return total + (typeof count === 'number' ? count : 0)
  }, 0)
}

export async function drainStripeOperationalRecovery(limit = 10) {
  const bounded = Math.max(1, Math.min(limit, 20))
  const enabled = process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED === 'true'
  let platform: string | null = null
  let token: string | null = null
  let runId: string | null = null

  if (enabled) {
    const runtime = await stripeRuntime()
    platform = runtime.config.platform
    const started = await recoveryRpc<{
      acquired: boolean
      runId?: string
      token?: string
    }>('start', platform)
    if (!started.acquired)
      return {
        enabled: true,
        acquired: false,
        status: 'busy' as const,
        degraded: false,
        processed: 0,
        steps: {},
        summary: null,
      }
    if (!started.runId || !started.token)
      throw new ListingApiError('Operational recovery is unavailable.', 503)
    runId = started.runId
    token = started.token
  }

  const steps: Record<StepName, StepResult> = {
    setup: await runStep('setup', () => drainStripeEvents(bounded)),
    orderPayments: await runStep('orderPayments', () =>
      drainStripeOrderPayments(bounded)
    ),
    orderDisputes: await runStep('orderDisputes', () =>
      drainStripeOrderDisputes(bounded)
    ),
    orderRefunds: await runStep('orderRefunds', () =>
      drainStripeOrderRefundWork(bounded)
    ),
    orderTransfers: await runStep('orderTransfers', () =>
      drainStripeOrderTransferWork(bounded)
    ),
    connectedPayouts: await runStep('connectedPayouts', () =>
      drainStripeConnectedPayoutObservations(bounded)
    ),
  }
  const errors = Object.values(steps)
    .filter((step): step is Extract<StepResult, { ok: false }> => !step.ok)
    .map((step) => step.errorCode)
  let sweep: Record<string, unknown> | null = null
  let summary: Record<string, unknown> | null = null

  if (enabled && platform && token) {
    try {
      sweep = await recoveryRpc('sweep', platform, token, { limit: bounded })
    } catch {
      errors.push('case_sweep_failed')
    }
    await recoveryRpc('finish', platform, token, {
      status: errors.length ? 'degraded' : 'completed',
      errors,
      steps,
    })
    summary = await recoveryRpc('summary', platform)
  }

  return {
    enabled,
    acquired: true,
    status: errors.length
      ? ('degraded' as const)
      : Object.values(steps).every(
          (step) => step.ok && step.status === 'disabled'
        )
      ? ('disabled' as const)
      : Object.values(steps).some(
          (step) => step.ok && step.status === 'completed'
        )
      ? ('completed' as const)
      : Object.values(steps).some(
          (step) => step.ok && step.status === 'needs_attention'
        )
      ? ('needs_attention' as const)
      : ('idle' as const),
    runId,
    degraded: errors.length > 0,
    processed: Object.values(steps).reduce<number>(
      (total, result) => total + processed(result),
      0
    ),
    successfulSteps: Object.values(steps).filter((step) => step.ok).length,
    failedSteps: Object.values(steps).filter((step) => !step.ok).length,
    disabledSteps: Object.values(steps).filter(
      (step) => step.ok && step.status === 'disabled'
    ).length,
    steps,
    sweep,
    summary,
  }
}
