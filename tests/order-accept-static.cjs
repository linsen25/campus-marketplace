const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const sql = fs.readFileSync(
  'supabase/migrations/202610100002_order_accept.sql',
  'utf8'
)
assert.equal(
  crypto
    .createHash('sha256')
    .update(
      fs.readFileSync('supabase/migrations/202610100001_order_requests.sql')
    )
    .digest('hex'),
  '5fae29019242fe24af2491805d06dd513051311e25811306387d7b0788dd775f'
)
for (const contract of [
  'orders_listing_hold',
  'orders_unfinished_buyer',
  'orders_participant_read',
  'for update',
  'r.buyer_id is distinct from actor',
  "interval '30 minutes'",
  'shipping_pending',
  "set search_path=''",
  'not_enabled',
  'reservation_expired',
  'marketplace_order_detail',
  'marketplace_order_workspace',
  'terms_snapshot is distinct from to_jsonb(r)',
  'Server reservation release required.',
]) {
  assert(sql.includes(contract), contract)
}
assert(
  !/create table.*order_payments|stripe|mark_paid|simulate_paid/i.test(sql)
)
const formal = fs.readFileSync('components/home/formal-orders.tsx', 'utf8')
assert(!/acceptPreview|setPaid|onMarkPaid|previewPerspective/.test(formal))
const chat = fs.readFileSync('components/home/messages-chat.tsx', 'utf8')
assert(chat.includes('eligibleRequestIds'))
assert(chat.includes('currentUserId'))
assert(chat.includes('acceptOrderRequest'))
console.log(
  'PASS Accept static: Phase 1 hash, server locks/roles/unique constraints/snapshots/expiry, pending shipping, no payment/preview authority'
)
