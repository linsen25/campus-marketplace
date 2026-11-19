const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261118024311_shop_billing_invoice_proof_entitlements.sql'
  ),
  'utf8'
)
const adapter = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-entitlements.ts'),
  'utf8'
)
const webhook = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-webhook.ts'),
  'utf8'
)

assert.match(migration, /shop_billing_invoice_entitlement_applications/)
assert.match(migration, /invoice_proof_id uuid not null unique/)
assert.match(migration, /proof_entitlement_applied/)
assert.match(migration, /Immutable verified Billing Invoice proof required/)
assert.match(migration, /marketplace_shop_billing_apply_invoice_proof/)
assert.match(migration, /marketplace_shop_billing_apply_verified_invoice/)
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/)
assert.match(migration, /for update/)
assert.match(
  migration,
  /revoke all on marketplace_private\.shop_billing_invoice_entitlement_applications/
)
assert.match(migration, /shop_billing_invoice_proofs p/)
assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/)
assert.match(adapter, /shopBillingEntitlementSyncConfiguration\(\)/)
assert.match(adapter, /marketplace_shop_billing_apply_verified_invoice/)
assert.match(webhook, /shopBillingEntitlementSyncEnabled\(\)/)
assert.match(webhook, /reconciliation\?\.proofEligible/)
assert.match(webhook, /synchronizeShopBillingEntitlements/)

console.log(
  'PASS Shop Billing Phase 4B-3 static contract: immutable proof-gated Provider Terms, service-only application records, closed feature gate, and no browser entitlement path.'
)
