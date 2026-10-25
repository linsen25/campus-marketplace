const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
class ApiError extends Error {}
const platform = 'acct_TestPlatform'
const claim = {
  eventId: 'evt_Dispute',
  eventType: 'charge.dispute.created',
  providerReference: 'du_Test',
  lease: '11111111-1111-4111-8111-111111111111',
}
function objects(overrides = {}) {
  const intent = {
    id: 'pi_Order',
    livemode: false,
    currency: 'cad',
    metadata: {
      uu_order: 'order-id',
      uu_attempt: 'attempt-id',
      uu_kind: 'marketplace_order',
      uu_environment: 'staging',
    },
  }
  const charge = {
    id: 'ch_Order',
    livemode: false,
    amount: 10000,
    amount_refunded: 2000,
    currency: 'cad',
    payment_intent: intent.id,
  }
  const dispute = {
    id: claim.providerReference,
    object: 'dispute',
    amount: 4000,
    balance_transactions: [
      {
        id: 'txn_Withdrawn',
        amount: -4000,
        currency: 'cad',
        source: claim.providerReference,
        reporting_category: 'dispute',
        status: 'available',
        type: 'adjustment',
      },
    ],
    charge: charge.id,
    created: 1792616400,
    currency: 'cad',
    evidence_details: {
      due_by: 1793221200,
      has_evidence: false,
      past_due: false,
      submission_count: 0,
    },
    livemode: false,
    payment_intent: intent.id,
    reason: 'product_not_received',
    status: 'needs_response',
    ...overrides,
  }
  return { charge, dispute, intent }
}
function load(value) {
  const code = ts.transpileModule(
    fs.readFileSync(path.resolve('lib/server/stripe-order-dispute.ts'), 'utf8'),
    { compilerOptions: { module: 1, target: 9, esModuleInterop: true } }
  ).outputText
  const module = { exports: {} }
  const stripe = {
    disputes: { retrieve: async () => value.dispute },
    charges: { retrieve: async () => value.charge },
    paymentIntents: { retrieve: async () => value.intent },
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
            rpc: async (rpcName, args) => {
              value.calls.push({ rpcName, args })
              if (args.p_action === 'claim')
                return { data: value.claims.shift() || null, error: null }
              return {
                data: value.rpcResult || {},
                error: value.rpcError || null,
              }
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
  const previous = process.env.STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED
  try {
    delete process.env.STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED
    let value = { ...objects(), runtimeCalls: 0, calls: [], claims: [claim] }
    assert.equal((await load(value).drainStripeOrderDisputes()).enabled, false)
    assert.equal(value.runtimeCalls, 0)

    process.env.STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED = 'true'
    for (const status of [
      'needs_response',
      'under_review',
      'won',
      'lost',
      'warning_needs_response',
      'warning_under_review',
      'warning_closed',
    ]) {
      value = {
        ...objects({ status }),
        runtimeCalls: 0,
        calls: [],
        claims: [{ ...claim, eventId: `evt_${status.replaceAll('_', '')}` }],
      }
      assert.equal((await load(value).drainStripeOrderDisputes()).processed, 1)
      const observation = value.calls.find(
        (item) => item.args.p_action === 'apply'
      ).args.p_value
      assert.equal(observation.providerStatus, status)
      assert.equal(observation.fundsWithdrawn, '4000')
      assert.equal(observation.chargeRefunded, '2000')
      assert.equal(observation.amount, '4000')
    }
    value = {
      ...objects({
        status: 'won',
        balance_transactions: [
          {
            id: 'txn_Reinstated',
            amount: 4000,
            currency: 'cad',
            source: claim.providerReference,
            reporting_category: 'dispute',
            status: 'available',
            type: 'adjustment',
          },
        ],
      }),
      runtimeCalls: 0,
      calls: [],
      claims: [{ ...claim, eventType: 'charge.dispute.funds_reinstated' }],
    }
    await load(value).drainStripeOrderDisputes()
    assert.equal(
      value.calls.find((item) => item.args.p_action === 'apply').args.p_value
        .fundsReinstated,
      '4000'
    )
    for (const override of [
      { livemode: true },
      { payment_intent: 'pi_Other' },
      { charge: 'ch_Other' },
      { currency: 'usd' },
      { amount: 10001 },
    ]) {
      value = {
        ...objects(override),
        runtimeCalls: 0,
        calls: [],
        claims: [claim],
      }
      assert.equal((await load(value).drainStripeOrderDisputes()).mismatches, 1)
      assert(value.calls.some((item) => item.args.p_action === 'done_mismatch'))
    }
    value = {
      ...objects(),
      runtimeCalls: 0,
      calls: [],
      claims: [claim],
      rpcError: { message: 'synthetic failure' },
    }
    await assert.rejects(() => load(value).drainStripeOrderDisputes())
    const source = fs.readFileSync('lib/server/stripe-order-dispute.ts', 'utf8')
    assert(!/disputes\.(update|close)\(/.test(source))
    assert(!/refunds\.create\(|transfers\.create\(/.test(source))
    console.log(
      'PASS B25-A Stripe Dispute observer, evidence separation, mismatch and no provider actions'
    )
  } finally {
    if (previous === undefined)
      delete process.env.STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED
    else process.env.STRIPE_ORDER_DISPUTE_OBSERVATION_ENABLED = previous
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
