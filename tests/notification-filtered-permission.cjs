// Static regression for the B29 filtered-notification permission omission.
// This does not claim PostgreSQL/RLS execution; it proves the forward
// migration explicitly corrects the final function definition and contract.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const b29 = fs.readFileSync(
  'supabase/migrations/20261024052628_notification_filtered_pagination.sql',
  'utf8'
)
const m008 = fs.readFileSync(
  'supabase/migrations/202610260008_verified_account_core_permissions.sql',
  'utf8'
)
const m009 = fs.readFileSync(
  'supabase/migrations/202610260009_notification_verified_permissions.sql',
  'utf8'
)
const signature =
  'marketplace_notifications_filtered(timestamptz,uuid,text,text)'

assert.match(b29, /marketplace_notifications_filtered\(/)
assert.match(b29, /marketplace_private\.is_western_user\(\)/)
assert(!m008.includes('marketplace_notifications_filtered'))
assert.match(
  m009,
  /create or replace function public\.marketplace_notifications_filtered\(/
)
assert.match(m009, /marketplace_private\.is_verified_user\(\)/)
assert(
  !m009.match(/if actor[\s\S]{0,180}marketplace_private\.is_western_user\(\)/)
)
assert.match(m009, /set search_path=''/)
assert.match(m009, /recipient_user_id=\$1/)
assert.match(m009, /interval '90 days'/)
assert.match(m009, /limit 51/)
assert.match(
  m009,
  new RegExp(
    `revoke all on function public\\.${signature.replace(/[()]/g, '\\$&')}`
  )
)
assert.match(
  m009,
  /grant execute on function public\.marketplace_notifications_filtered\(timestamptz,uuid,text,text\)\s+to authenticated/
)
console.log(
  'PASS filtered notification omission identified and corrected by explicit 009 signature migration'
)
console.log(
  'NOT TESTED PostgreSQL execution, RLS behavior and real user notification isolation'
)
