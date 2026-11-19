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
  path.join(
    __dirname,
    '..',
    'lib/server/shop-billing-reversal-entitlements.ts'
  ),
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
        shopBillingReversalEntitlementSyncConfiguration: () => {
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
  const reversalProofId = '90000000-0000-4000-8000-000000000001'
  await assert.rejects(
    () =>
      loaded.exports.synchronizeShopBillingReversalEntitlement({
        reversalProofId,
      }),
    (value) => value instanceof ListingApiError && value.status === 503
  )
  assert.equal(calls.length, 0)

  enabled = true
  await loaded.exports.synchronizeShopBillingReversalEntitlement({
    reversalProofId,
  })
  assert.deepEqual(calls, [
    {
      name: 'marketplace_shop_billing_apply_reversal_proof',
      p_reversal_proof_id: reversalProofId,
    },
  ])

  error = { code: '23514' }
  await assert.rejects(
    () =>
      loaded.exports.synchronizeShopBillingReversalEntitlement({
        reversalProofId,
      }),
    (value) =>
      value instanceof ListingApiError && value.billingTerminal === true
  )
  error = { code: '08006' }
  await assert.rejects(
    () =>
      loaded.exports.synchronizeShopBillingReversalEntitlement({
        reversalProofId,
      }),
    (value) =>
      value instanceof ListingApiError &&
      value.status === 503 &&
      value.billingTerminal !== true
  )
  console.log(
    'PASS Shop Billing reversal entitlement adapter fixtures: dual-flag denial, proof-only RPC input, terminal proof rejection, and retryable provider/database failure.'
  )
}
main().catch((value) => {
  console.error(value)
  process.exitCode = 1
})
