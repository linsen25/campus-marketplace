const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')

const migration = fs.readFileSync(
  path.join(
    __dirname,
    '..',
    'supabase/migrations/20261117160034_shop_billing_security_foundation.sql'
  ),
  'utf8'
)

for (const table of [
  'shop_billing_customers',
  'shop_billing_subscriptions',
  'shop_billing_invoices',
  'shop_billing_events',
  'shop_billing_audit_log',
]) {
  assert.match(
    migration,
    new RegExp(`create table marketplace_private\\.${table} \\(`)
  )
  assert.match(
    migration,
    new RegExp(
      `alter table marketplace_private\\.${table} enable row level security;`
    )
  )
}

assert.match(
  migration,
  /unique \(provider, provider_account_id, provider_event_id\)/
)
assert.match(
  migration,
  /unique \(provider, provider_account_id, provider_subscription_id\)/
)
assert.match(migration, /validate_shop_billing_relationships\(\)/)
assert.match(migration, /protect_shop_billing_audit_log\(\)/)
assert.match(migration, /set search_path=''/)
assert.match(
  migration,
  /revoke all on marketplace_private\.shop_billing_customers,[\s\S]*from public, anon, authenticated, service_role;/
)
assert.doesNotMatch(
  migration,
  /shop_memberships\s+(?:set|update|insert|delete)/i
)
console.log(
  'PASS Shop Billing Phase 2 static contract: private provider records, fail-closed access, relationship integrity, event idempotency, and immutable audit history.'
)
