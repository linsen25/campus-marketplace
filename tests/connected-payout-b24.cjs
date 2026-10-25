const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

const platform = 'acct_TestPlatform'
const account = 'acct_ConnectedSeller'
const claim = {
  eventId: 'evt_PayoutCreated',
  eventType: 'payout.created',
  providerReference: 'po_TestPayout',
  connectedAccount: account,
  lease: '24666666-6666-4666-8666-666666666666',
}

function payout(overrides = {}) {
  return {
    id: claim.providerReference,
    object: 'payout',
    amount: 14200,
    arrival_date: 1792706400,
    automatic: true,
    balance_transaction: 'txn_PayoutDebit',
    created: 1792616400,
    currency: 'cad',
    failure_balance_transaction: null,
    failure_code: null,
    livemode: false,
    method: 'standard',
    reconciliation_status: 'in_progress',
    status: 'pending',
    ...overrides,
  }
}

function state(overrides = {}) {
  return {
    runtimeCalls: 0,
    rpc: [],
    claims: [],
    payout: payout(),
    retrieves: [],
    ...overrides,
  }
}

function loadAdapter(value) {
  const code = ts.transpileModule(
    fs.readFileSync(
      path.resolve('lib/server/stripe-connected-payout.ts'),
      'utf8'
    ),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }
  ).outputText
  const module = { exports: {} }
  const stripe = {
    payouts: {
      retrieve: async (id, params, options) => {
        value.retrieves.push({ id, params, options })
        if (value.retrieveError) throw value.retrieveError
        return value.payout
      },
    },
  }
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/listing-validation')
        return { ListingApiError: ApiError }
      if (name === '@/lib/server/stripe-runtime')
        return {
          stripeRuntime: async () => {
            value.runtimeCalls++
            return { config: { platform }, stripe }
          },
        }
      if (name === '@/lib/server/financial-capabilities-service')
        return {
          createTrustedFinancialClient: () => ({
            rpc: async (name, args) => {
              value.rpc.push({ name, args })
              if (args.p_action === 'claim')
                return { data: value.claims.shift() || null, error: null }
              return { data: {}, error: value.rpcError || null }
            },
          }),
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

async function main() {
  const previous = process.env.STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED
  try {
    delete process.env.STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED
    const disabled = state({ claims: [claim] })
    assert.deepEqual(
      await loadAdapter(disabled).drainStripeConnectedPayoutObservations(),
      { enabled: false, processed: 0, retried: 0, mismatches: 0 }
    )
    assert.equal(disabled.runtimeCalls, 0)
    assert.equal(disabled.rpc.length, 0)

    process.env.STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED = 'true'
    const happy = state({ claims: [claim] })
    assert.deepEqual(
      await loadAdapter(happy).drainStripeConnectedPayoutObservations(),
      { enabled: true, processed: 1, retried: 0, mismatches: 0 }
    )
    assert.deepEqual(happy.retrieves[0], {
      id: claim.providerReference,
      params: {},
      options: { stripeAccount: account },
    })
    const applied = happy.rpc.find((entry) => entry.args.p_action === 'apply')
    assert(applied)
    assert.equal(applied.args.p_value.providerStatus, 'pending')
    assert.equal(applied.args.p_value.attributionStatus, 'unattributed')
    assert.equal(applied.args.p_value.connectedAccount, account)
    assert(!JSON.stringify(applied).includes('failure_message'))

    const manual = state({
      claims: [{ ...claim, eventId: 'evt_ManualPayout' }],
      payout: payout({ automatic: false, method: 'instant' }),
    })
    assert.equal(
      (await loadAdapter(manual).drainStripeConnectedPayoutObservations())
        .processed,
      1
    )
    const manualObservation = manual.rpc.find(
      (entry) => entry.args.p_action === 'apply'
    ).args.p_value
    assert.equal(manualObservation.automatic, false)
    assert.equal(manualObservation.method, 'instant')

    for (const [eventType, status, reconciliationStatus] of [
      ['payout.updated', 'in_transit', 'in_progress'],
      ['payout.paid', 'paid', 'completed'],
      ['payout.failed', 'failed', 'completed'],
      ['payout.canceled', 'canceled', 'not_applicable'],
      ['payout.reconciliation_completed', 'paid', 'completed'],
    ]) {
      const item = state({
        claims: [
          {
            ...claim,
            eventId: `evt_${status.replace(/[^a-z]/g, '')}`,
            eventType,
          },
        ],
        payout: payout({ status, reconciliation_status: reconciliationStatus }),
      })
      const result = await loadAdapter(
        item
      ).drainStripeConnectedPayoutObservations()
      assert.equal(result.processed, 1)
      assert.equal(
        item.rpc.find((entry) => entry.args.p_action === 'apply').args.p_value
          .providerStatus,
        status
      )
    }

    const wrongAccount = state({
      claims: [{ ...claim, connectedAccount: platform }],
    })
    assert.equal(
      (await loadAdapter(wrongAccount).drainStripeConnectedPayoutObservations())
        .mismatches,
      1
    )
    assert.equal(wrongAccount.retrieves.length, 1)
    assert(
      wrongAccount.rpc.some((entry) => entry.args.p_action === 'done_mismatch')
    )

    for (const override of [
      { livemode: true },
      { id: 'po_Conflict' },
      { amount: 14201.5 },
      { currency: 'usd' },
      { method: 'unknown' },
      { status: 'unknown' },
    ]) {
      const mismatch = state({ claims: [claim], payout: payout(override) })
      const result = await loadAdapter(
        mismatch
      ).drainStripeConnectedPayoutObservations()
      assert.equal(result.mismatches, 1)
      assert(
        mismatch.rpc.some((entry) => entry.args.p_action === 'done_mismatch')
      )
    }

    const unavailable = state({
      claims: [claim],
      retrieveError: new Error('Synthetic provider timeout'),
    })
    assert.equal(
      (await loadAdapter(unavailable).drainStripeConnectedPayoutObservations())
        .retried,
      1
    )
    assert(unavailable.rpc.some((entry) => entry.args.p_action === 'retry'))

    const enqueued = state()
    assert.equal(
      await loadAdapter(enqueued).enqueueStripeConnectedPayoutEvent({
        connectedAccount: account,
        eventId: claim.eventId,
        eventType: claim.eventType,
        payoutId: claim.providerReference,
      }),
      true
    )
    assert.equal(enqueued.rpc[0].args.p_action, 'enqueue')
    assert.equal(enqueued.rpc[0].args.p_value.scope, account)

    const source = fs.readFileSync(
      'lib/server/stripe-connected-payout.ts',
      'utf8'
    )
    assert(!source.includes('.payouts.create('))
    assert(!source.includes('.payouts.cancel('))
    assert(!source.includes('.payouts.reverse('))
    assert(!source.includes('order_id'))
    console.log('B24-C connected Payout adapter qualification passed')
  } finally {
    if (previous === undefined)
      delete process.env.STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED
    else process.env.STRIPE_CONNECTED_PAYOUT_OBSERVATION_ENABLED = previous
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
