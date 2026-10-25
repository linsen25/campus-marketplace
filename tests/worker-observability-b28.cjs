// B28-B server orchestration tests. No env file, provider or network is used.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

function loadRoute(state) {
  const code = ts.transpileModule(
    fs.readFileSync('pages/api/stripe/worker.ts', 'utf8'),
    { compilerOptions: { module: 1, target: 9, esModuleInterop: true } }
  ).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === 'crypto') return require(name)
      if (name === '@/lib/server/stripe-operational-recovery')
        return {
          drainStripeOperationalRecovery: async () => {
            if (state.rejectFinancial) throw Error('sensitive provider error')
            return state.financial
          },
        }
      if (name === '@/lib/server/shop-suspension-lifecycle')
        return {
          drainShopSuspensionLifecycle: async () => {
            if (state.rejectShop) throw Error('private lifecycle error')
            return state.shop
          },
        }
      if (name === '@/lib/server/worker-observability')
        return {
          configuredStripeWorkerPlatform: () => 'acct_TestPlatform',
          startStripeWorkerRun: async () =>
            state.busy
              ? { acquired: false }
              : { acquired: true, token: 'audit-token' },
          finishStripeWorkerRun: async (_platform, token, value) => {
            assert.equal(token, 'audit-token')
            state.finishes.push(value)
            if (state.finishFailure) throw Error('audit unavailable')
          },
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports.default
}

function response() {
  return {
    code: 0,
    body: null,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    end() {
      return this
    },
  }
}

async function invoke(state) {
  const res = response()
  await loadRoute(state)(
    {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.STRIPE_WORKER_SECRET}` },
    },
    res
  )
  return res
}

async function main() {
  const previous = process.env.STRIPE_WORKER_SECRET
  process.env.STRIPE_WORKER_SECRET = 'x'.repeat(40)
  try {
    let state = {
      finishes: [],
      financial: {
        status: 'completed',
        degraded: false,
        processed: 2,
        successfulSteps: 6,
        failedSteps: 0,
      },
      shop: {
        enabled: true,
        busy: false,
        offersClosed: 1,
        messagesInserted: 1,
        cyclesReopened: 0,
      },
    }
    let res = await invoke(state)
    assert.equal(res.code, 200)
    assert.equal(state.finishes[0].status, 'completed')
    assert.equal(state.finishes[0].processedCount, 4)

    state = {
      ...state,
      finishes: [],
      rejectFinancial: true,
      financial: undefined,
    }
    res = await invoke(state)
    assert.equal(res.code, 503)
    assert.equal(state.finishes[0].status, 'degraded')
    assert.equal(state.finishes[0].phases.shopLifecycle.processed, 2)
    assert.deepEqual(state.finishes[0].errorCodes, [
      'financial_coordinator_failed',
    ])
    assert.equal(JSON.stringify(state.finishes).includes('sensitive'), false)

    state = { ...state, finishes: [], busy: true }
    res = await invoke(state)
    assert.equal(res.code, 200)
    assert.equal(res.body.runtimeStatus, 'busy')
    assert.equal(state.finishes.length, 0)

    console.log(
      'PASS B28-B Worker audit: completed/degraded/busy outcomes, partial-success evidence and sanitized errors'
    )
  } finally {
    if (previous === undefined) delete process.env.STRIPE_WORKER_SECRET
    else process.env.STRIPE_WORKER_SECRET = previous
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
