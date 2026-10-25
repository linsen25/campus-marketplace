// B27-A static boundaries. Runtime authority is covered by the two isolated DB suites.
const assert = require('node:assert/strict')
const fs = require('node:fs')

const migration = fs.readFileSync(
  'supabase/migrations/20261023173802_authoritative_shop_provider_notifications.sql',
  'utf8'
)
const messageProjection = fs.readFileSync(
  'supabase/migrations/202610150009_contact_seller_first_contact.sql',
  'utf8'
)
const delivery = fs.readFileSync(
  'supabase/migrations/202610150004_notification_delivery_foundation.sql',
  'utf8'
)

for (const trigger of [
  'shop_membership_notification_projector',
  'shop_suspension_notification_projector',
  'order_refund_notification_projector',
  'order_transfer_notification_projector',
  'connected_payout_notification_projector',
])
  assert.match(migration, new RegExp(`create trigger ${trigger}`))

assert.match(
  migration,
  /revoke all on function marketplace_private\.emit_authoritative_notification[\s\S]*from public,anon,authenticated,service_role/
)
assert.match(
  messageProjection,
  /new\.origin='marketplace_auto_reply' then return new/
)
for (const kind of [
  'shop_trial_activated',
  'shop_suspended',
  'order_refund_succeeded',
  'seller_transfer_succeeded',
  'connected_bank_payout_paid',
])
  assert(!delivery.includes(`'${kind}'`), `${kind} must remain out of email`)

assert(!/stripe_dispute_observations/.test(migration))
assert(!/operational_cases/.test(migration))
assert(
  !/insert into marketplace_private\.notification_deliveries/i.test(migration)
)
assert(!/grant execute/i.test(migration))

console.log(
  'PASS B27-A static boundaries: authoritative triggers, private execution, system-message exclusion, in-app-only defaults and deferred policy domains'
)
