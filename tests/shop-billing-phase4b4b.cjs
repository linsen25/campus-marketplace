const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261118091746_shop_billing_reversal_entitlements.sql'
  ),
  'utf8'
)
const environment = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-environment.ts'),
  'utf8'
)
const adapter = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-reversal-entitlements.ts'),
  'utf8'
)
const webhook = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-webhook.ts'),
  'utf8'
)

assert.match(
  migration,
  /create table marketplace_private\.shop_billing_reversal_entitlement_applications/
)
assert.match(migration, /reversal_proof_id uuid not null unique/)
assert.match(migration, /provider_term_id uuid not null unique/)
assert.match(migration, /security definer set search_path=''/)
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/)
assert.match(migration, /for update/)
assert.match(migration, /v_reversal\.reversal_type <> 'refund'/)
assert.match(migration, /v_reversal\.source_status <> 'succeeded'/)
assert.match(migration, /revoked_at = v_now, revoke_reason = 'refund'/)
assert.match(migration, /provider_term_revoked/)
assert.match(migration, /from public, anon, authenticated, service_role/)
assert.doesNotMatch(migration, /apply_paid_invoice/)
assert.match(
  environment,
  /SHOP_BILLING_REVERSAL_ENTITLEMENT_SYNC_ENABLED === 'true'/
)
assert.match(environment, /shopBillingEntitlementSyncEnabled\(\)/)
assert.match(adapter, /marketplace_shop_billing_apply_reversal_proof/)
assert.match(webhook, /synchronizeShopBillingReversalEntitlement/)

console.log(
  'PASS Shop Billing Phase 4B-4B static contract: full-refund proof-only term revocation, dual closed flags, exact bindings, and no client path.'
)
