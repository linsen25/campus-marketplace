const fs = require('node:fs'),
  assert = require('node:assert/strict')
const priorMigration = fs.readFileSync(
  'supabase/migrations/202611070006_interac_email_verification_gate.sql',
  'utf8'
)
const migration = fs.readFileSync(
  'supabase/migrations/202611070007_interac_email_auth_claim_fix.sql',
  'utf8'
)
assert.match(priorMigration, /verified_at timestamptz/)
assert.match(priorMigration, /e\.verified_at is not null/)
assert.match(priorMigration, /marketplace_get_interac_receiving_email_status/)
assert.match(
  migration,
  /revoke all on table marketplace_private\.interac_receiving_emails\s+from public, anon, authenticated, service_role/
)
assert.match(migration, /security definer/)
assert.match(migration, /auth\.jwt\(\)->>'email'/)
assert.match(migration, /from auth\.users u/)
assert.match(migration, /u\.email_confirmed_at is not null/)
assert.match(migration, /lower\(u\.email\) = normalized/)
assert.match(migration, /email_confirmed_at/)
assert.doesNotMatch(
  migration,
  /grant\s+(?:select|insert|update|delete|all).*interac_receiving_emails.*authenticated/i
)
assert.match(
  migration,
  /revoke all on function public\.marketplace_get_interac_receiving_email_status/
)
assert.doesNotMatch(migration, /bank_account|account_number|transit_number|sin_number/i)
console.log(
  'PASS Interac secondary-email pending gate, verified-order visibility, no bank credential storage'
)
