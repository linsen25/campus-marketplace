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
  path.join(__dirname, '..', 'lib/server/shop-billing-entitlements.ts'),
  'utf8'
)
const calls = []
let enabled = false
let error = null
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: 1, target: 7, esModuleInterop: true },
}).outputText
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === '@/lib/listing-validation') return { ListingApiError }
    if (name === '@/lib/server/shop-billing-environment')
      return {
        shopBillingEntitlementSyncConfiguration: () => {
          if (!enabled) throw new ListingApiError('disabled', 503)
          return {}
        },
      }
    if (name === '@/lib/server/financial-capabilities-service')
      return {
        createTrustedFinancialClient: () => ({
          rpc: async (name, params) => {
            calls.push({ name, ...params })
            return { data: {}, error }
          },
        }),
      }
    return require(name)
  },
  loaded,
  loaded.exports
)

async function main() {
  await assert.rejects(
    () =>
      loaded.exports.synchronizeShopBillingEntitlements({
        verifiedInvoiceId: '70000000-0000-4000-8000-000000000001',
        subscriptionId: '60000000-0000-4000-8000-000000000001',
        subscriptionStatus: 'active',
      }),
    (value) => value instanceof ListingApiError && value.status === 503
  )
  assert.equal(calls.length, 0)
  enabled = true
  await loaded.exports.synchronizeShopBillingEntitlements({
    verifiedInvoiceId: '70000000-0000-4000-8000-000000000001',
    subscriptionId: '60000000-0000-4000-8000-000000000001',
    subscriptionStatus: 'active',
  })
  assert.deepEqual(
    calls.map((call) => call.name),
    [
      'marketplace_shop_billing_apply_verified_invoice',
      'marketplace_shop_billing_membership_command',
    ]
  )
  assert.equal(
    calls[0].p_billing_invoice_id,
    '70000000-0000-4000-8000-000000000001'
  )
  assert.equal(calls[1].p_action, 'resolve_payment_state')
  calls.length = 0
  await loaded.exports.synchronizeShopBillingEntitlements({
    subscriptionId: '60000000-0000-4000-8000-000000000001',
    subscriptionStatus: 'past_due',
  })
  assert.deepEqual(
    calls.map((call) => call.p_action),
    ['record_payment_failure']
  )
  error = { code: '23514' }
  await assert.rejects(
    () =>
      loaded.exports.synchronizeShopBillingEntitlements({
        verifiedInvoiceId: '70000000-0000-4000-8000-000000000001',
        subscriptionId: '60000000-0000-4000-8000-000000000001',
        subscriptionStatus: 'active',
      }),
    (value) =>
      value instanceof ListingApiError && value.billingTerminal === true
  )
  console.log(
    'PASS Shop Billing entitlement adapter fixtures: flag-off denial, proof-only application, bounded payment-state calls, and terminal database rejection.'
  )
}
main().catch((value) => {
  console.error(value)
  process.exitCode = 1
})
