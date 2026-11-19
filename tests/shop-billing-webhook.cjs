const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const source = fs.readFileSync(
  path.join(__dirname, '..', 'lib/server/shop-billing-webhook.ts'),
  'utf8'
)
const events = new Map()
const calls = []
let fixture = null
let syncError = null
let retrieveError = false
let reversalEnabled = false
let reversalError = null
const reversalCalls = []
let reversalEntitlementEnabled = false
let reversalResult = { proofEligible: false }
const reversalEntitlementCalls = []
let reversalReviewEnabled = false
const reversalReviewCalls = []
const subscription = {
  id: 'sub_Test',
  customer: 'cus_Test',
  livemode: false,
  status: 'active',
  cancel_at_period_end: false,
  canceled_at: null,
  ended_at: null,
  items: {
    data: [
      {
        price: { id: 'price_Plus' },
        current_period_start: 1761955200,
        current_period_end: 1764547200,
      },
    ],
  },
}
const rpc = async (name, params) => {
  calls.push({ name, ...params })
  if (name === 'marketplace_shop_billing_sync_subscription')
    return { data: null, error: syncError }
  const key = params.p_event_id
  const current = events.get(key)
  if (params.p_action === 'ingest') {
    if (!current)
      events.set(key, {
        state: 'received',
        eventType: params.p_value.eventType,
        objectId: params.p_value.objectId,
        customerId: params.p_value.customerId,
        subscriptionId: params.p_value.subscriptionId,
        providerCreatedAt: params.p_value.providerCreatedAt,
      })
    return { data: {}, error: null }
  }
  if (params.p_action === 'claim') {
    if (!current || current.state !== 'received')
      return { data: { claimed: false }, error: null }
    current.state = 'processing'
    return {
      data: {
        claimed: true,
        lease: '10000000-0000-4000-8000-000000000001',
        eventType: current.eventType,
        objectId: current.objectId,
        customerId: current.customerId,
        subscriptionId: current.subscriptionId,
        providerCreatedAt: current.providerCreatedAt,
      },
      error: null,
    }
  }
  if (current)
    current.state =
      params.p_action === 'complete'
        ? 'processed'
        : params.p_action === 'retry'
        ? 'retryable'
        : 'failed'
  return { data: {}, error: null }
}
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: 1, target: 7, esModuleInterop: true },
}).outputText
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === '@/lib/listing-validation') return { ListingApiError }
    if (name === '@/lib/server/financial-capabilities-service')
      return { createTrustedFinancialClient: () => ({ rpc }) }
    if (name === '@/lib/server/shop-billing-environment')
      return {
        shopBillingWebhookConfiguration: () => ({
          platform: 'acct_Test',
          webhookSecret: 'whsec_Test',
          prices: { plus: 'price_Plus', pro: 'price_Pro' },
        }),
        // Phase 4B-2 remains closed in this established Phase 4A fixture.
        shopBillingInvoiceReconciliationEnabled: () => false,
        shopBillingInvoiceReconciliationConfiguration: () => {
          throw Error('disabled')
        },
        shopBillingEntitlementSyncEnabled: () => false,
        shopBillingReversalReconciliationEnabled: () => reversalEnabled,
        shopBillingReversalEntitlementSyncEnabled: () =>
          reversalEntitlementEnabled,
        shopBillingReversalReviewEnabled: () => reversalReviewEnabled,
      }
    if (name === '@/lib/server/shop-billing-entitlements')
      return { synchronizeShopBillingEntitlements: async () => {} }
    if (name === '@/lib/server/shop-billing-reversals')
      return {
        shopBillingReversalEventTypes: ['refund.created'],
        isShopBillingReversalEvent: (type) => type === 'refund.created',
        reconcileShopBillingReversal: async (value) => {
          reversalCalls.push(value)
          if (reversalError) throw reversalError
          return reversalResult
        },
      }
    if (name === '@/lib/server/shop-billing-reversal-entitlements')
      return {
        synchronizeShopBillingReversalEntitlement: async (value) => {
          reversalEntitlementCalls.push(value)
        },
      }
    if (name === '@/lib/server/shop-billing-reversal-reviews')
      return {
        registerShopBillingReversalReview: async (value) => {
          reversalReviewCalls.push(value)
        },
      }
    if (name === '@/lib/server/stripe-runtime')
      return {
        stripeRuntime: async () => ({
          stripe: {
            webhooks: {
              constructEvent: () => {
                if (!fixture) throw Error('signature')
                return fixture
              },
            },
            subscriptions: {
              retrieve: async () => {
                if (retrieveError) throw Error('timeout')
                return subscription
              },
            },
          },
        }),
      }
    return require(name)
  },
  loaded,
  loaded.exports
)
const event = (id, type = 'customer.subscription.updated', extras = {}) => ({
  id,
  type,
  livemode: false,
  created: 1763337600,
  data: { object: { id: 'sub_Test', customer: 'cus_Test', ...extras } },
})
async function expectReject(value, status) {
  await assert.rejects(
    () =>
      loaded.exports.receiveShopBillingWebhook(Buffer.from('fixture'), 'sig'),
    (error) => error instanceof ListingApiError && error.status === status
  )
  fixture = value
}
async function main() {
  fixture = null
  await expectReject(null, 400)
  fixture = { ...event('evt_Live'), livemode: true }
  await expectReject(fixture, 400)
  fixture = { ...event('evt_Account'), account: 'acct_Other' }
  await expectReject(fixture, 400)
  fixture = event('evt_Good')
  await loaded.exports.receiveShopBillingWebhook(Buffer.from('fixture'), 'sig')
  await loaded.exports.receiveShopBillingWebhook(Buffer.from('fixture'), 'sig')
  assert.equal(
    calls.filter(
      (call) =>
        call.name === 'marketplace_shop_billing_sync_subscription' &&
        call.p_event_id === 'evt_Good'
    ).length,
    1
  )
  fixture = event('evt_Unknown', 'customer.created', { id: 'cus_Test' })
  await loaded.exports.receiveShopBillingWebhook(Buffer.from('unknown'), 'sig')
  assert.equal(
    calls.filter(
      (call) =>
        call.name === 'marketplace_shop_billing_sync_subscription' &&
        call.p_event_id === 'evt_Unknown'
    ).length,
    0
  )
  syncError = { code: '23514' }
  fixture = event('evt_Unbound')
  await loaded.exports.receiveShopBillingWebhook(Buffer.from('unbound'), 'sig')
  assert.equal(events.get('evt_Unbound').state, 'failed')
  syncError = null
  retrieveError = true
  fixture = event('evt_Timeout')
  await loaded.exports.receiveShopBillingWebhook(Buffer.from('timeout'), 'sig')
  assert.equal(events.get('evt_Timeout').state, 'retryable')
  retrieveError = false
  reversalEnabled = true
  fixture = event('evt_Reversal', 'refund.created', { id: 're_Test' })
  await loaded.exports.receiveShopBillingWebhook(Buffer.from('reversal'), 'sig')
  await loaded.exports.receiveShopBillingWebhook(Buffer.from('reversal'), 'sig')
  assert.equal(reversalCalls.length, 1)
  assert.equal(events.get('evt_Reversal').state, 'processed')
  reversalReviewEnabled = true
  reversalResult = {
    proofEligible: false,
    reversalStateId: '91000000-0000-4000-8000-000000000001',
    classification: 'manual_review',
  }
  fixture = event('evt_ReversalReview', 'refund.created', { id: 're_Review' })
  await loaded.exports.receiveShopBillingWebhook(
    Buffer.from('reversal-review'),
    'sig'
  )
  assert.deepEqual(reversalReviewCalls, [
    { reversalStateId: '91000000-0000-4000-8000-000000000001' },
  ])
  reversalEntitlementEnabled = true
  reversalResult = {
    proofEligible: true,
    reversalProofId: '90000000-0000-4000-8000-000000000001',
  }
  fixture = event('evt_ReversalProof', 'refund.created', { id: 're_Proof' })
  await loaded.exports.receiveShopBillingWebhook(
    Buffer.from('reversal-proof'),
    'sig'
  )
  assert.deepEqual(reversalEntitlementCalls, [
    { reversalProofId: '90000000-0000-4000-8000-000000000001' },
  ])
  reversalError = Object.assign(new Error('provider 404'), { statusCode: 404 })
  fixture = event('evt_Reversal404', 'refund.created', { id: 're_Missing' })
  await loaded.exports.receiveShopBillingWebhook(
    Buffer.from('reversal-404'),
    'sig'
  )
  assert.equal(events.get('evt_Reversal404').state, 'retryable')
  reversalError = null
  console.log(
    'PASS Shop Billing webhook fixtures: signature/live/account rejection, duplicate/unknown events, reversal routing, terminal binding failure, and retryable provider timeout/404.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
