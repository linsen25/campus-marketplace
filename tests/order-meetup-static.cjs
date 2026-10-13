const fs = require('fs'),
  assert = require('assert/strict'),
  crypto = require('crypto')
const sql = fs.readFileSync(
  'supabase/migrations/202610120005_order_meetup.sql',
  'utf8'
)
assert.equal(
  crypto
    .createHash('sha256')
    .update(
      fs.readFileSync('supabase/migrations/202610120004_offer_accept.sql')
    )
    .digest('hex'),
  '7141e92183ba407861f0cd6e32af19be7ec854020c08d4c31a89114cbc4db370'
)
for (const text of [
  'order_meetup_one_pending',
  "r.scheduled_at+interval '60 minutes'",
  'meetup_expiries',
  'clock_timestamp()',
  'r.proposed_by=actor',
  'base_confirmed_id<>cur.id',
  "status='superseded'",
  'No D2/payment/handoff',
  'order_no_show_expired',
  'old.order_protocol_version=2',
  'settle_order_meetup(p_listing)',
  "o.fulfillment_status='awaiting_payment'",
  "revision=0 and status='confirmed'",
])
  assert(sql.includes(text), text)
assert(!sql.includes("accepted_at+interval '30 minutes'"))
assert(!sql.includes('create table public.payments'))
const action = sql.slice(
  sql.indexOf('create function public.marketplace_order_meetup_action'),
  sql.indexOf('create function marketplace_private.settle_order_meetup')
)
assert(
  action.indexOf('from public.listings') <
    action.indexOf('for update;\n if not marketplace_private')
)
assert(action.includes('(v-array') === false)
assert(sql.includes("(v-array['location','scheduled_at','note'])<>'{}'"))
console.log(
  'PASS D1 immutable C2, schedule authority, recipient decision, lock order, exact grace and scope boundaries'
)

const guard = fs.readFileSync(
  'supabase/migrations/202610120006_order_meetup_guard.sql',
  'utf8'
)
assert(guard.includes('order_meetup_revisions mr on mr.id=e.confirmed_id'))
const detail = fs.readFileSync(
  'components/home/formal-v2-order-detail.tsx',
  'utf8'
)
assert(detail.includes('onUpdated={onUpdated || (() => {})}'))
assert(!detail.includes('onUpdated={onCancelled}'))
assert(
  fs
    .readFileSync('components/home/formal-orders.tsx', 'utf8')
    .includes(
      'onUpdated={(value, serverTime) => query.applyOrder(value, serverTime)}'
    )
)
console.log(
  'PASS receipted expiry SQL alias and schedule mutation stays on exact Order instead of cancellation navigation'
)

const retention = fs.readFileSync(
  'supabase/migrations/202610120007_order_meetup_retention.sql',
  'utf8'
)
assert(
  retention.includes(
    "old.lifecycle_status='open' and new.lifecycle_status='expired'"
  )
)
assert(
  retention.includes(
    'new.buyer_id is null and not exists(select 1 from public.profiles'
  )
)
console.log(
  'PASS expiry transition guard preserves historical participant FK updates'
)

for (const [name, sha] of Object.entries({
  '202610120005_order_meetup.sql':
    'efc126a2a3f336007cf129de7c8a345c072eb9ea6e09ad66b035e4e87d9f6a6a',
  '202610120006_order_meetup_guard.sql':
    'e6927b32a89e2b86f984593bb6d28f512e8341fe733ad9c8c9dabfa736bbcc30',
  '202610120007_order_meetup_retention.sql':
    'd5f635840da81b3be228b2a619c9552d6a66e0d21ed1bac6e6dc85ef40233a8e',
}))
  assert.equal(
    crypto
      .createHash('sha256')
      .update(fs.readFileSync('supabase/migrations/' + name))
      .digest('hex'),
    sha
  )
console.log('PASS all applied D1 source hashes remain immutable')
