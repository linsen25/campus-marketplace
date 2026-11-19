const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const source = fs.readFileSync(
  path.join(__dirname, '..', 'lib/server/shop-billing-environment.ts'),
  'utf8'
)
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const loaded = { exports: {} }
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === '@/lib/listing-validation') return { ListingApiError }
    if (name === '@/lib/server/stripe-environment')
      return { stripeConfiguration: () => ({ platform: 'acct_Test' }) }
    return require(name)
  },
  loaded,
  loaded.exports
)

const original = process.env.SHOP_BILLING_ENTITLEMENT_SYNC_ENABLED
try {
  delete process.env.SHOP_BILLING_ENTITLEMENT_SYNC_ENABLED
  assert.throws(
    () => loaded.exports.shopBillingEntitlementSyncConfiguration(),
    (error) => error instanceof ListingApiError && error.status === 503
  )
  process.env.SHOP_BILLING_ENTITLEMENT_SYNC_ENABLED = 'false'
  assert.throws(() => loaded.exports.shopBillingEntitlementSyncConfiguration())
} finally {
  if (original === undefined)
    delete process.env.SHOP_BILLING_ENTITLEMENT_SYNC_ENABLED
  else process.env.SHOP_BILLING_ENTITLEMENT_SYNC_ENABLED = original
}

console.log(
  'PASS Shop Billing entitlement sync remains fail-closed unless explicitly enabled.'
)
