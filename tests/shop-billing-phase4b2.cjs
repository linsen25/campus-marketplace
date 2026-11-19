const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261117212126_shop_billing_invoice_reconciliation.sql'
  ),
  'utf8'
)
const webhook = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-webhook.ts'),
  'utf8'
)
const environment = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-environment.ts'),
  'utf8'
)

assert.match(migration, /shop_billing_invoice_proofs/)
assert.match(migration, /shop_billing_invoice_reconciliation_audit/)
assert.match(migration, /marketplace_shop_billing_reconcile_invoice/)
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/)
assert.match(migration, /for update/)
assert.match(migration, /provider_event_version > v_version/)
assert.match(
  migration,
  /unique \(provider, provider_account_id, provider_invoice_id\)/
)
assert.match(migration, /proof history is immutable/i)
assert.match(
  migration,
  /grant execute on function public\.marketplace_shop_billing_reconcile_invoice[\s\S]*to service_role/
)
assert.doesNotMatch(migration, /shop_membership_command\s*\(/)
assert.doesNotMatch(
  migration,
  /marketplace_shop_billing_membership_command\s*\(/
)
assert.match(webhook, /invoices\.retrieve\(claim\.objectId\)/)
assert.match(webhook, /invoices\.listLineItems\(invoice\.id/)
assert.match(webhook, /lineItems\.has_more/)
assert.match(webhook, /invoice\.payment_action_required/)
assert.match(webhook, /subscription_item_details/)
assert.match(webhook, /proration === true/)
assert.match(webhook, /marketplace_shop_billing_reconcile_invoice/)
assert.match(
  environment,
  /SHOP_BILLING_INVOICE_RECONCILIATION_ENABLED === 'true'/
)

console.log(
  'PASS Shop Billing Phase 4B-2 static contract: Test-only invoice fetch/reconciliation, service-only proof persistence, binding/version checks, immutable audit, and no Membership mutation.'
)
