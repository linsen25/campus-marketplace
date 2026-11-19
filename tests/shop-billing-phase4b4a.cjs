const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.join(__dirname, '..')
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261118083423_shop_billing_reversal_reconciliation.sql'
  ),
  'utf8'
)
const webhook = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-webhook.ts'),
  'utf8'
)
const reversals = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-reversals.ts'),
  'utf8'
)
const environment = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-environment.ts'),
  'utf8'
)

assert.match(
  migration,
  /create table marketplace_private\.shop_billing_reversal_states/
)
assert.match(
  migration,
  /create table marketplace_private\.shop_billing_reversal_proofs/
)
assert.match(
  migration,
  /create table marketplace_private\.shop_billing_reversal_reconciliation_audit/
)
assert.match(
  migration,
  /unique \(provider, provider_account_id, provider_reversal_id\)/
)
assert.match(migration, /invoice_proof_id uuid not null unique/)
assert.match(migration, /enable row level security/)
assert.match(migration, /from public, anon, authenticated, service_role/)
assert.match(
  migration,
  /marketplace_shop_billing_reconcile_reversal\([\s\S]*?security definer set search_path=''/
)
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/)
assert.match(migration, /for update/)
assert.match(migration, /reversal_state_stale/)
assert.match(migration, /reversal_manual_review/)
assert.match(migration, /reversal_proof_created/)
assert.doesNotMatch(migration, /apply_reversal_proof/)
assert.doesNotMatch(
  migration,
  /update marketplace_private\.shop_membership_provider_terms set revoked_at/
)
assert.doesNotMatch(
  migration,
  /update marketplace_private\.shop_memberships set revision/
)

assert.match(
  environment,
  /SHOP_BILLING_REVERSAL_RECONCILIATION_ENABLED === 'true'/
)
assert.match(webhook, /shopBillingReversalEventTypes/)
assert.match(webhook, /isShopBillingReversalEvent\(claim\.eventType\)/)
assert.match(webhook, /reconcileShopBillingReversal/)
assert.match(reversals, /stripe\.refunds\.retrieve/)
assert.match(reversals, /stripe\.disputes\.retrieve/)
assert.match(reversals, /stripe\.paymentIntents\.retrieve/)
assert.match(reversals, /stripe\.invoices\.retrieve/)
assert.match(reversals, /marketplace_shop_billing_reconcile_reversal/)
assert.doesNotMatch(reversals, /marketplace_shop_billing_membership_command/)

console.log(
  'PASS Shop Billing Phase 4B-4A static contract: Test-only trusted reversal facts/proofs, closed feature gate, no entitlement mutation.'
)
