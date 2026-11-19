const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')

const root = path.join(__dirname, '..')
const checkout = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-checkout.ts'),
  'utf8'
)
const environment = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-environment.ts'),
  'utf8'
)
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261117161641_shop_billing_checkout_command.sql'
  ),
  'utf8'
)

assert.match(checkout, /mode: 'subscription'/)
assert.match(
  checkout,
  /line_items: \[\{ price: config\.prices\[input\.tier\], quantity: 1 \}\]/
)
assert.match(checkout, /idempotencyKey: `uu:test:shop-billing:checkout:/)
assert.match(
  checkout,
  /createShopMembershipRepository\(\s*context\s*\)\.getOwnMembership\(\)/
)
assert.match(checkout, /requireMarketplaceUser\(client\)/)
assert.doesNotMatch(
  checkout,
  /amountCents|customerId.*body|subscriptionId.*body/
)
assert.match(environment, /SHOP_BILLING_CHECKOUT_ENABLED !== 'true'/)
assert.match(environment, /stripeConfiguration\(\)/)
assert.match(environment, /STRIPE_SHOP_PLUS_PRICE_ID/)
assert.match(
  migration,
  /grant execute on function public\.marketplace_shop_billing_checkout_command[\s\S]*to service_role/
)
assert.match(
  migration,
  /revoke all on function public\.marketplace_shop_billing_checkout_command[\s\S]*from public, anon, authenticated, service_role/
)
assert.match(migration, /Stale membership revision/)
assert.match(migration, /Existing Billing subscription requires reconciliation/)
assert.match(migration, /shop_billing_one_open_checkout_per_owner/)

class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const compiled = ts.transpileModule(checkout, {
  compilerOptions: { module: 1, target: 7, esModuleInterop: true },
}).outputText
const moduleValue = { exports: {} }
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === '@/lib/listing-validation') return { ListingApiError }
    if (name === '@/lib/server/financial-capabilities-service')
      return { createTrustedFinancialClient: () => ({}) }
    if (name === '@/lib/server/shop-billing-environment')
      return { shopBillingCheckoutConfiguration: () => ({}) }
    if (name === '@/lib/server/shop-membership-repository')
      return { createShopMembershipRepository: () => ({}) }
    if (name === '@/lib/server/stripe-runtime')
      return { stripeRuntime: async () => ({}) }
    if (name === '@/lib/server/marketplace-auth')
      return { requireMarketplaceUser: async () => ({}) }
    if (name === '@/lib/supabase/server')
      return { createMarketplaceClient: () => ({}) }
    return require(name)
  },
  moduleValue,
  moduleValue.exports
)
const parse = moduleValue.exports.parseShopBillingCheckoutInput
assert.deepEqual(
  parse({
    tier: 'plus',
    membershipRevision: 0,
    actionId: '10000000-0000-4000-8000-000000000001',
  }),
  {
    tier: 'plus',
    membershipRevision: 0,
    actionId: '10000000-0000-4000-8000-000000000001',
  }
)
for (const value of [
  null,
  {
    tier: 'pro',
    membershipRevision: 0,
    actionId: '10000000-0000-4000-8000-000000000001',
    amount: 1,
  },
  {
    tier: 'pro',
    membershipRevision: -1,
    actionId: '10000000-0000-4000-8000-000000000001',
  },
  {
    tier: 'enterprise',
    membershipRevision: 0,
    actionId: '10000000-0000-4000-8000-000000000001',
  },
  { tier: 'plus', membershipRevision: 0, actionId: 'not-a-uuid' },
])
  assert.throws(() => parse(value), ListingApiError)
console.log(
  'PASS Shop Billing Phase 3 static contract: Test-only feature guard, server price allowlist, authenticated owner/revision checks, and idempotent Checkout preparation.'
)
