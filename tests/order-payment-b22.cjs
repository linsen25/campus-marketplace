// B22 offline reconciliation adapter tests. No network, env files or remote data.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

let rpcCalls = []
let claims = { claim_event: [], claim_unbound: [], claim_due: [] }
let retrieveError = false
let recoveryCalls = []
const intent = {
  id: 'pi_B22',
  object: 'payment_intent',
  status: 'succeeded',
  livemode: false,
  amount: 10825,
  amount_received: 10825,
  currency: 'cad',
  customer: 'cus_Buyer',
  payment_method: 'pm_Card',
  on_behalf_of: 'acct_Seller',
  transfer_group: 'uu_order_order-1',
  metadata: {
    uu_order: 'order-1',
    uu_attempt: 'attempt-1',
    uu_kind: 'marketplace_order',
    uu_environment: 'staging',
  },
}

async function databaseRpc(name, args) {
  assert.equal(name, 'marketplace_order_payment_reconciliation')
  rpcCalls.push(args)
  if (args.p_action.startsWith('claim_'))
    return { data: claims[args.p_action].shift() || null, error: null }
  if (args.p_action.startsWith('apply_'))
    return {
      data: {
        result:
          args.p_value.providerStatus === 'processing' ? 'pending' : 'applied',
        attemptId: args.p_value.attemptId,
        orderId: args.p_value.orderId,
        providerStatus: args.p_value.providerStatus,
        exceptionCode: null,
      },
      error: null,
    }
  return { data: {}, error: null }
}

const dependencies = {
  '@/lib/listing-validation': { ListingApiError },
  '@/lib/server/financial-capabilities-service': {
    createTrustedFinancialClient: () => ({ rpc: databaseRpc }),
  },
  '@/lib/server/stripe-runtime': {
    stripeRuntime: async () => ({
      config: { platform: 'acct_Platform' },
      stripe: {
        paymentIntents: {
          retrieve: async (id) => {
            assert.equal(id, 'pi_B22')
            if (retrieveError) throw new Error('synthetic timeout')
            return { ...intent, metadata: { ...intent.metadata } }
          },
        },
      },
    }),
  },
  '@/lib/server/stripe-order-payment': {
    prepareOrderPaymentConfirmation: async (...args) => {
      recoveryCalls.push(args)
      return { nextAction: 'reconcile' }
    },
  },
}

function load(file) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => dependencies[name] || require(name),
    module,
    module.exports
  )
  return module.exports
}

async function main() {
  const service = load('lib/server/stripe-order-reconciliation.ts')
  assert.deepEqual(service.orderPaymentEventTypes, [
    'payment_intent.succeeded',
    'payment_intent.payment_failed',
    'payment_intent.processing',
    'payment_intent.canceled',
  ])

  await service.enqueueStripeOrderPaymentEvent({
    eventId: 'evt_B22',
    eventType: 'payment_intent.succeeded',
    paymentIntentId: 'pi_B22',
  })
  const enqueue = rpcCalls.at(-1)
  assert.equal(enqueue.p_action, 'enqueue')
  assert.deepEqual(enqueue.p_value, {
    id: 'evt_B22',
    type: 'payment_intent.succeeded',
    scope: 'acct_Platform',
    providerReference: 'pi_B22',
  })

  rpcCalls = []
  claims.claim_event.push({
    claimKind: 'event',
    eventId: 'evt_B22',
    eventType: 'payment_intent.succeeded',
    providerReference: 'pi_B22',
    lease: 'lease-event',
  })
  let result = await service.drainStripeOrderPayments(1)
  assert.deepEqual(result, {
    processed: 1,
    recovered: 0,
    pending: 0,
    exceptions: 0,
  })
  const applied = rpcCalls.find((call) => call.p_action === 'apply_event')
  assert(applied)
  assert.equal(applied.p_token, 'lease-event')
  assert.equal(applied.p_value.evidenceId, 'evt_B22')
  assert.equal(applied.p_value.providerStatus, 'succeeded')
  assert.equal(applied.p_value.amountReceived, 10825)
  assert.equal(applied.p_value.metadataKind, 'marketplace_order')

  rpcCalls = []
  retrieveError = true
  claims.claim_event.push({
    claimKind: 'event',
    eventId: 'evt_Retry',
    eventType: 'payment_intent.processing',
    providerReference: 'pi_B22',
    lease: 'lease-retry',
  })
  result = await service.drainStripeOrderPayments(1)
  assert.equal(result.processed, 0)
  assert.equal(
    rpcCalls.find((call) => call.p_action === 'retry_event').p_token,
    'lease-retry'
  )

  rpcCalls = []
  retrieveError = false
  intent.status = 'processing'
  intent.amount_received = 0
  claims.claim_due.push({
    claimKind: 'due',
    attemptId: 'attempt-1',
    providerReference: 'pi_B22',
    lease: 'lease-due',
  })
  result = await service.drainStripeOrderPayments(1)
  assert.equal(result.processed, 1)
  assert.equal(result.pending, 1)
  const due = rpcCalls.find((call) => call.p_action === 'apply_due')
  assert(due.p_value.evidenceId.startsWith('reconcile:'))
  assert.equal(due.p_value.providerStatus, 'processing')

  rpcCalls = []
  claims.claim_unbound.push({
    claimKind: 'unbound',
    attemptId: 'attempt-timeout',
    buyerId: 'buyer-1',
  })
  result = await service.drainStripeOrderPayments(1)
  assert.equal(result.recovered, 1)
  assert.deepEqual(recoveryCalls.at(-1), ['attempt-timeout', 'buyer-1'])
  assert(
    !rpcCalls.some(
      (call) =>
        call.p_action.includes('refund') ||
        call.p_action.includes('transfer') ||
        call.p_action.includes('payout')
    )
  )
  console.log(
    'PASS B22 signed-event enqueue boundary, authoritative retrieval, event/due retry, UNKNOWN binding recovery, and no money movement'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
