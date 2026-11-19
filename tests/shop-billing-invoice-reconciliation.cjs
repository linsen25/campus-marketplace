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
let invoice = null
let lines = null
let subscription = null
let entitlementEnabled = false
const entitlementCalls = []

const rpc = async (name, params) => {
  calls.push({ name, ...params })
  const event = events.get(params.p_event_id)
  if (name === 'marketplace_shop_billing_sync_subscription')
    return {
      data: { subscriptionId: '60000000-0000-4000-8000-000000000001' },
      error: null,
    }
  if (name === 'marketplace_shop_billing_reconcile_invoice') {
    if (params.p_value.verificationState === 'verified_paid')
      assert.equal(params.p_value.priceId, 'price_Pro')
    return {
      data: {
        invoiceId: params.p_value.invoiceId,
        proofEligible: params.p_value.verificationState === 'verified_paid',
      },
      error: null,
    }
  }
  if (params.p_action === 'ingest') {
    events.set(params.p_event_id, {
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
    if (!event || event.state !== 'received')
      return { data: { claimed: false }, error: null }
    event.state = 'processing'
    return {
      data: {
        claimed: true,
        lease: '10000000-0000-4000-8000-000000000001',
        eventType: event.eventType,
        objectId: event.objectId,
        customerId: event.customerId,
        subscriptionId: event.subscriptionId,
        providerCreatedAt: event.providerCreatedAt,
      },
      error: null,
    }
  }
  if (event)
    event.state =
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
        shopBillingInvoiceReconciliationEnabled: () => true,
        shopBillingInvoiceReconciliationConfiguration: () => ({
          platform: 'acct_Test',
          webhookSecret: 'whsec_Test',
          prices: { plus: 'price_Plus', pro: 'price_Pro' },
        }),
        shopBillingEntitlementSyncEnabled: () => entitlementEnabled,
        shopBillingReversalReconciliationEnabled: () => false,
        shopBillingReversalEntitlementSyncEnabled: () => false,
      }
    if (name === '@/lib/server/shop-billing-entitlements')
      return {
        synchronizeShopBillingEntitlements: async (value) => {
          entitlementCalls.push(value)
        },
      }
    if (name === '@/lib/server/shop-billing-reversals')
      return {
        shopBillingReversalEventTypes: [],
        isShopBillingReversalEvent: () => false,
        reconcileShopBillingReversal: async () => {},
      }
    if (name === '@/lib/server/shop-billing-reversal-entitlements')
      return { synchronizeShopBillingReversalEntitlement: async () => {} }
    if (name === '@/lib/server/stripe-runtime')
      return {
        stripeRuntime: async () => ({
          stripe: {
            webhooks: { constructEvent: () => fixture },
            subscriptions: { retrieve: async () => subscription },
            invoices: {
              retrieve: async () => invoice,
              listLineItems: async () => ({ data: lines, has_more: false }),
            },
          },
        }),
      }
    return require(name)
  },
  loaded,
  loaded.exports
)

const makeSubscription = () => ({
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
        price: { id: 'price_Pro' },
        current_period_start: 1761955200,
        current_period_end: 1764547200,
      },
    ],
  },
})
const makeInvoice = () => ({
  id: 'in_Test',
  customer: 'cus_Test',
  subscription: 'sub_Test',
  livemode: false,
  status: 'paid',
  currency: 'cad',
  amount_due: 499,
  amount_paid: 499,
  attempt_count: 1,
  billing_reason: 'subscription_cycle',
  status_transitions: { paid_at: 1761955200 },
})
const makeLine = (overrides = {}) => ({
  id: 'il_Test',
  amount: 499,
  subscription: 'sub_Test',
  parent: {
    type: 'subscription_item_details',
    subscription_item_details: { proration: false },
  },
  pricing: { price_details: { price: 'price_Pro' } },
  period: { start: 1761955200, end: 1764547200 },
  ...overrides,
})
const event = (id, type) => ({
  id,
  type,
  livemode: false,
  created: 1763337600,
  data: {
    object: { id: 'in_Test', customer: 'cus_Test', subscription: 'sub_Test' },
  },
})

async function receive(id, type = 'invoice.paid') {
  fixture = event(id, type)
  await loaded.exports.receiveShopBillingWebhook(Buffer.from(id), 'sig')
}

async function main() {
  subscription = makeSubscription()
  invoice = makeInvoice()
  lines = [makeLine()]
  await receive('evt_Paid')
  const paid = calls.find(
    (call) =>
      call.name === 'marketplace_shop_billing_reconcile_invoice' &&
      call.p_event_id === 'evt_Paid'
  )
  assert.equal(paid.p_value.verificationState, 'verified_paid')
  assert.equal(events.get('evt_Paid').state, 'processed')
  assert.equal(entitlementCalls.length, 0)

  entitlementEnabled = true
  await receive('evt_Entitled')
  assert.deepEqual(entitlementCalls, [
    {
      verifiedInvoiceId: paid.p_value.invoiceId,
      subscriptionId: '60000000-0000-4000-8000-000000000001',
      subscriptionStatus: 'active',
    },
  ])
  entitlementEnabled = false

  lines = [
    makeLine({
      parent: {
        type: 'subscription_item_details',
        subscription_item_details: { proration: true },
      },
    }),
  ]
  await receive('evt_Proration')
  const proration = calls.find(
    (call) =>
      call.name === 'marketplace_shop_billing_reconcile_invoice' &&
      call.p_event_id === 'evt_Proration'
  )
  assert.equal(proration.p_value.verificationState, 'unsupported')

  lines = [makeLine(), makeLine({ id: 'il_Second' })]
  await receive('evt_Multi')
  const multi = calls.find(
    (call) =>
      call.name === 'marketplace_shop_billing_reconcile_invoice' &&
      call.p_event_id === 'evt_Multi'
  )
  assert.equal(multi.p_value.verificationState, 'unsupported')

  invoice = {
    ...makeInvoice(),
    status: 'open',
    amount_paid: 0,
    status_transitions: { paid_at: null },
  }
  lines = [makeLine()]
  await receive('evt_Failed', 'invoice.payment_failed')
  const failed = calls.find(
    (call) =>
      call.name === 'marketplace_shop_billing_reconcile_invoice' &&
      call.p_event_id === 'evt_Failed'
  )
  assert.equal(failed.p_value.verificationState, 'payment_failed')

  invoice = { ...makeInvoice(), customer: 'cus_Other' }
  await receive('evt_Mismatch')
  assert.equal(events.get('evt_Mismatch').state, 'failed')
  assert.equal(
    calls.some(
      (call) =>
        call.name === 'marketplace_shop_billing_reconcile_invoice' &&
        call.p_event_id === 'evt_Mismatch'
    ),
    false
  )

  console.log(
    'PASS Shop Billing invoice reconciliation fixtures: Stripe re-fetch, verified paid proof, proration/multi-line fail-closed, payment failure, and binding rejection.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
