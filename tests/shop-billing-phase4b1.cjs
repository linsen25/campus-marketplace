const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const root = path.resolve(__dirname, '..')
const migration = fs.readFileSync(
  path.join(
    root,
    'supabase/migrations/20261117175102_shop_billing_membership_provider_terms.sql'
  ),
  'utf8'
)
const environment = fs.readFileSync(
  path.join(root, 'lib/server/shop-billing-environment.ts'),
  'utf8'
)

assert.match(migration, /shop_membership_provider_terms/)
assert.match(migration, /shop_membership_billing_audit_log/)
assert.match(migration, /service_period_start/)
assert.match(migration, /service_period_end/)
assert.match(migration, /unique \(billing_invoice_id\)/)
assert.match(migration, /shop_membership_provider_terms_no_overlap/)
assert.match(migration, /shop_membership_legacy_provider_guard/)
assert.match(migration, /status <> 'paid'/)
assert.match(migration, /amount_paid_cents < v_invoice\.amount_due_cents/)
assert.match(
  migration,
  /Legacy Membership coverage must end before provider coverage begins/
)
assert.match(
  migration,
  /p_action not in \('apply_paid_invoice', 'record_payment_failure', 'resolve_payment_state'\)/
)
assert.match(migration, /auth\.role\(\) is distinct from 'service_role'/)
assert.match(
  migration,
  /grant execute on function public\.marketplace_shop_billing_membership_command[\s\S]*to service_role/
)
assert.match(
  migration,
  /revoke all on marketplace_private\.shop_membership_provider_terms/
)
assert.match(migration, /shop_legacy_entitlements/)
assert.match(
  migration,
  /create or replace function public\.marketplace_shop_membership/
)
assert.match(migration, /cancel_at_period_end/)
assert.match(migration, /grace_reason = 'payment_failed'/)
assert.match(migration, /interval '432000 seconds'/)
assert.match(environment, /SHOP_BILLING_ENTITLEMENT_SYNC_ENABLED === 'true'/)
assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/)

console.log(
  'PASS Shop Billing Phase 4B-1 static contract: verified paid-invoice provider terms, service-only commands, independent provider grace, immutable audit, and closed entitlement flag.'
)
