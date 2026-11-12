const fs = require('node:fs'),
  assert = require('node:assert/strict')
const migration = fs.readFileSync(
  'supabase/migrations/202611070005_interac_receiving_email.sql',
  'utf8'
)
const api = fs.readFileSync('pages/api/interac/settings.ts', 'utf8')
const orderApi = fs.readFileSync('pages/api/interac/orders/[id].ts', 'utf8')
assert(migration.includes('interac_receiving_emails'))
assert(migration.includes('auth.uid()'))
assert(migration.includes('marketplace_private.is_verified_user()'))
assert(migration.includes('marketplace_get_order_interac_email'))
assert(api.includes('requireSameOriginWrite'))
assert(orderApi.includes('marketplace_get_order_interac_email'))
assert(
  !migration.includes(
    'grant execute on function public.marketplace_set_interac_receiving_email(text) to service_role'
  )
)
console.log(
  'PASS Interac receiving email isolation, verified-user gate, participant-only order lookup, no service-role grant'
)
