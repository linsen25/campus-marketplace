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
  path.join(__dirname, '..', 'lib/server/shop-billing-reversals.ts'),
  'utf8'
)
const calls = []
let refund = null
let dispute = null
let invoiceCurrency = 'cad'
let timeout = false

const invoice = () => ({
  id: 'in_Test',
  customer: 'cus_Test',
  subscription: 'sub_Test',
  livemode: false,
  currency: invoiceCurrency,
  amount_due: 499,
  amount_paid: 499,
})
const line = () => ({
  id: 'il_Test',
  amount: 499,
  subscription: 'sub_Test',
  parent: {
    type: 'subscription_item_details',
    subscription_item_details: { proration: false },
  },
  pricing: { price_details: { price: 'price_Pro' } },
})
const event = (eventId, eventType, objectId) => ({
  eventId,
  lease: '10000000-0000-4000-8000-000000000001',
  eventType,
  objectId,
  providerCreatedAt: '2026-11-18T12:00:00.000Z',
})
const rpc = async (name, params) => {
  calls.push({ name, ...params })
  return { data: { applied: true }, error: null }
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
        shopBillingReversalReconciliationConfiguration: () => ({
          platform: 'acct_Test',
          prices: { plus: 'price_Plus', pro: 'price_Pro' },
        }),
      }
    if (name === '@/lib/server/stripe-runtime')
      return {
        stripeRuntime: async () => ({
          stripe: {
            refunds: {
              retrieve: async () => {
                if (timeout) throw Error('provider timeout')
                return refund
              },
              list: async () => ({
                data: refund ? [refund] : [],
                has_more: false,
              }),
            },
            disputes: { retrieve: async () => dispute },
            charges: {
              retrieve: async () => ({
                id: 'ch_Test',
                customer: 'cus_Test',
                payment_intent: 'pi_Test',
                currency: 'cad',
                livemode: false,
              }),
            },
            paymentIntents: {
              retrieve: async () => ({
                id: 'pi_Test',
                customer: 'cus_Test',
                invoice: 'in_Test',
                livemode: false,
              }),
            },
            invoices: {
              retrieve: async () => invoice(),
              listLineItems: async () => ({ data: [line()], has_more: false }),
            },
          },
        }),
      }
    return require(name)
  },
  loaded,
  loaded.exports
)

async function reconcile(input) {
  await loaded.exports.reconcileShopBillingReversal(input)
  return calls.at(-1).p_value
}

async function main() {
  refund = {
    id: 're_Full',
    payment_intent: 'pi_Test',
    amount: 499,
    currency: 'cad',
    status: 'succeeded',
    livemode: false,
  }
  assert.equal(
    (await reconcile(event('evt_Refund', 'refund.created', 're_Full')))
      .classification,
    'verified_full_reversal'
  )

  refund = { ...refund, id: 're_Partial', amount: 100 }
  assert.equal(
    (await reconcile(event('evt_Partial', 'refund.updated', 're_Partial')))
      .classification,
    'manual_review'
  )

  dispute = {
    id: 'dp_Open',
    charge: 'ch_Test',
    amount: 499,
    currency: 'cad',
    status: 'needs_response',
    livemode: false,
  }
  assert.equal(
    (
      await reconcile(
        event('evt_DisputeOpen', 'charge.dispute.created', 'dp_Open')
      )
    ).classification,
    'observed'
  )
  dispute = { ...dispute, id: 'dp_Lost', status: 'lost' }
  assert.equal(
    (
      await reconcile(
        event('evt_DisputeLost', 'charge.dispute.closed', 'dp_Lost')
      )
    ).classification,
    'verified_full_reversal'
  )
  dispute = { ...dispute, id: 'dp_Withdrawn', status: 'under_review' }
  assert.equal(
    (
      await reconcile(
        event('evt_Withdrawn', 'charge.dispute.funds_withdrawn', 'dp_Withdrawn')
      )
    ).classification,
    'verified_full_reversal'
  )
  dispute = { ...dispute, id: 'dp_Reinstated', status: 'won' }
  assert.equal(
    (
      await reconcile(
        event(
          'evt_Reinstated',
          'charge.dispute.funds_reinstated',
          'dp_Reinstated'
        )
      )
    ).classification,
    'observed'
  )

  invoiceCurrency = 'usd'
  await assert.rejects(
    () => reconcile(event('evt_Currency', 'invoice.voided', 'in_Test')),
    (error) => error instanceof ListingApiError && error.status === 503
  )
  invoiceCurrency = 'cad'

  timeout = true
  await assert.rejects(() =>
    reconcile(event('evt_Timeout', 'refund.created', 're_Full'))
  )
  timeout = false

  assert.equal(
    calls.every(
      (call) => call.name === 'marketplace_shop_billing_reconcile_reversal'
    ),
    true
  )
  console.log(
    'PASS Shop Billing reversal fixtures: full/partial refunds, dispute states, strict currency binding, timeout propagation, and no Membership RPC.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
