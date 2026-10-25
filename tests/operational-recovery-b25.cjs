const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

class ApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}

function load(state) {
  const code = ts.transpileModule(
    fs.readFileSync('lib/server/stripe-operational-recovery.ts', 'utf8'),
    { compilerOptions: { module: 1, target: 9, esModuleInterop: true } }
  ).outputText
  const module = { exports: {} }
  const step =
    (name, value = { processed: 1 }) =>
    async (limit) => {
      state.calls.push([name, limit])
      if (state.allDisabled) return { enabled: false, processed: 0 }
      if (state.failure === name)
        throw state.configurationFailure
          ? new ApiError(
              'Secure account setup is unavailable. Please try again later.',
              503
            )
          : new Error('sk_test_sensitive_provider_failure')
      return value
    }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/listing-validation')
        return { ListingApiError: ApiError }
      if (name === '@/lib/server/financial-capabilities-service')
        return {
          createTrustedFinancialClient: () => ({
            rpc: async (rpcName, args) => {
              state.rpc.push([rpcName, args])
              if (args.p_action === 'start')
                return {
                  data: state.acquired
                    ? {
                        acquired: true,
                        runId: '11111111-1111-4111-8111-111111111111',
                        token: '22222222-2222-4222-8222-222222222222',
                      }
                    : { acquired: false },
                  error: null,
                }
              if (args.p_action === 'sweep')
                return { data: { synced: 2 }, error: state.sweepError || null }
              if (args.p_action === 'summary')
                return { data: { unresolvedCases: 2 }, error: null }
              return { data: { status: args.p_value.status }, error: null }
            },
          }),
        }
      if (name === '@/lib/server/stripe-runtime')
        return {
          stripeRuntime: async () => ({
            config: { platform: 'acct_TestPlatform' },
          }),
        }
      if (name === '@/lib/server/stripe-setup')
        return { drainStripeEvents: step('setup') }
      if (name === '@/lib/server/stripe-order-reconciliation')
        return { drainStripeOrderPayments: step('orderPayments') }
      if (name === '@/lib/server/stripe-order-dispute')
        return { drainStripeOrderDisputes: step('orderDisputes') }
      if (name === '@/lib/server/stripe-order-refund')
        return {
          drainStripeOrderRefundWork: step('orderRefunds', {
            events: { processed: 1 },
            refunds: { processed: 1 },
          }),
        }
      if (name === '@/lib/server/stripe-order-transfer')
        return {
          drainStripeOrderTransferWork: step('orderTransfers', {
            events: { processed: 1 },
            transfers: { processed: 1 },
          }),
        }
      if (name === '@/lib/server/stripe-connected-payout')
        return {
          drainStripeConnectedPayoutObservations: step('connectedPayouts'),
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

async function main() {
  const previous = process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED
  try {
    delete process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED
    let state = { calls: [], rpc: [], acquired: true }
    let result = await load(state).drainStripeOperationalRecovery(999)
    assert.equal(result.enabled, false)
    assert.equal(result.status, 'completed')
    assert.equal(result.successfulSteps, 6)
    assert.equal(result.processed, 8)
    assert.equal(state.rpc.length, 0)
    assert(state.calls.every((call) => call[1] === 20))

    process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED = 'true'
    state = {
      calls: [],
      rpc: [],
      acquired: true,
      failure: 'orderPayments',
      sweepError: { message: 'provider secret must not escape' },
    }
    result = await load(state).drainStripeOperationalRecovery(10)
    assert.equal(result.enabled, true)
    assert.equal(result.degraded, true)
    assert.equal(result.successfulSteps, 5)
    assert.equal(state.calls.length, 6)
    assert.equal(JSON.stringify(result).includes('sensitive'), false)
    assert.deepEqual(
      state.rpc.map((call) => call[1].p_action),
      ['start', 'sweep', 'finish', 'summary']
    )
    const finish = state.rpc.find((call) => call[1].p_action === 'finish')[1]
    assert.equal(finish.p_value.status, 'degraded')
    assert.deepEqual(finish.p_value.errors, [
      'order_payments_failed',
      'case_sweep_failed',
    ])
    assert.equal(result.steps.orderPayments.status, 'retryable_failure')

    state = {
      calls: [],
      rpc: [],
      acquired: true,
      failure: 'setup',
      configurationFailure: true,
    }
    result = await load(state).drainStripeOperationalRecovery(10)
    assert.equal(result.steps.setup.status, 'configuration_missing')

    delete process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED
    state = { calls: [], rpc: [], acquired: true, allDisabled: true }
    result = await load(state).drainStripeOperationalRecovery(10)
    assert.equal(result.status, 'disabled')
    assert.equal(result.disabledSteps, 6)

    process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED = 'true'
    state = { calls: [], rpc: [], acquired: false }
    result = await load(state).drainStripeOperationalRecovery(10)
    assert.equal(result.acquired, false)
    assert.equal(state.calls.length, 0)
    assert.equal(state.rpc.length, 1)

    const source = fs.readFileSync(
      'lib/server/stripe-operational-recovery.ts',
      'utf8'
    )
    assert(
      !/refunds\.create|transfers\.create|payouts\.(create|cancel)|disputes\.(update|close)/.test(
        source
      )
    )
    console.log(
      'PASS B25-C bounded recovery orchestration, step isolation, fenced audit, default-off gate and sanitized failures'
    )
  } finally {
    if (previous === undefined)
      delete process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED
    else process.env.STRIPE_OPERATIONAL_RECOVERY_ENABLED = previous
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
