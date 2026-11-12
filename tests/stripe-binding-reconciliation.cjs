// Offline security review for the not-yet-deployed Stripe binding reconciliation.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const migration = fs.readFileSync(
  'supabase/migrations/20261109190000_stripe_binding_reconciliation.sql',
  'utf8'
)
const setup = fs.readFileSync('lib/server/stripe-setup.ts', 'utf8')

assert.match(migration, /add column superseded_at timestamptz/)
assert.match(migration, /stripe_binding_reconciliation_audit/)
assert.match(migration, /provider_metadata_canonical/)
assert.match(migration, /require_stripe_staging\(\)/)
assert.match(migration, /pg_advisory_xact_lock/)
assert.match(migration, /id=p_metadata_binding[\s\S]*for update/)
assert.match(migration, /canonical\.user_id is distinct from p_user/)
assert.match(migration, /canonical\.platform is distinct from p_platform/)
assert.match(migration, /canonical\.owner_ref is distinct from p_owner_ref/)
assert.match(migration, /Connected account ownership conflict/)
assert.match(migration, /superseded_at is null/)
assert.doesNotMatch(
  migration,
  /delete\s+from\s+marketplace_private\.stripe_bindings/i
)
assert.match(
  migration,
  /revoke all on function public\.marketplace_reconcile_stripe_binding[\s\S]*from public,anon,authenticated,service_role/
)
assert.match(
  migration,
  /grant execute on function public\.marketplace_reconcile_stripe_binding[\s\S]*to service_role/
)

for (const signature of [
  'public.marketplace_stripe_binding(text,uuid,text,text,uuid,jsonb)',
  'public.marketplace_stripe_capabilities(uuid,text)',
  'public.marketplace_stripe_events(text,text,jsonb)',
  'public.marketplace_order_payment_provider(text,uuid,uuid,text,uuid,jsonb)',
  'public.marketplace_order_transfer_operation(text,uuid,text,uuid)',
  'marketplace_private.project_connected_payout_notification()',
])
  assert(migration.includes(signature), `missing reviewed consumer ${signature}`)

assert.match(setup, /owned\(account, b\)[\s\S]*reconcileVerifiedBinding\(b\)/)
assert.match(setup, /p_metadata_binding: b\.id/)
assert.match(setup, /p_owner_ref: b\.owner_ref/)
assert.match(setup, /p_platform: b\.platform/)
assert.doesNotMatch(setup, /superseded_at|superseded_by|delete.*binding/i)

console.log(
  'PASS Stripe binding reconciliation is provider-metadata anchored, audited, idempotent, service-only, active-row filtered, and non-destructive'
)
