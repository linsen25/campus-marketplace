const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const sha = (f) =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync('supabase/migrations/' + f))
    .digest('hex')
for (const [f, h] of Object.entries({
  '202610120004_offer_accept.sql':
    '7141e92183ba407861f0cd6e32af19be7ec854020c08d4c31a89114cbc4db370',
  '202610120005_order_meetup.sql':
    'efc126a2a3f336007cf129de7c8a345c072eb9ea6e09ad66b035e4e87d9f6a6a',
  '202610120006_order_meetup_guard.sql':
    'e6927b32a89e2b86f984593bb6d28f512e8341fe733ad9c8c9dabfa736bbcc30',
  '202610120007_order_meetup_retention.sql':
    'd5f635840da81b3be228b2a619c9552d6a66e0d21ed1bac6e6dc85ef40233a8e',
  '202610120008_order_campus_payment.sql':
    '9ee979c206dfb290268250e91718013a86b74ddbe84be890b4563127552362eb',
  '202610120009_order_campus_paid_inventory.sql':
    '6d0eab0a08093f88e8475d49b48c9e4ece065d9567d63f87704ec34e277ab9ff',
}))
  assert.equal(sha(f), h)
assert.equal(
  sha('202610120010_order_campus_payment_lock.sql'),
  '2d4e7561f95c4665466a7ec74357ca7ebbe817413208bc06f71b25ae87ced8c7'
)
const sql = fs.readFileSync(
  'supabase/migrations/202610120008_order_campus_payment.sql',
  'utf8'
)
const start = fs.readFileSync(
  'supabase/migrations/202610120010_order_campus_payment_lock.sql',
  'utf8'
)
assert(
  start.indexOf('lock_financial_capability') <
    start.indexOf('from public.listings where id=o.listing_id for update')
)
assert(
  start.indexOf('from public.listings where id=o.listing_id for update') <
    start.indexOf('where id=p_order_id for update')
)
assert(!start.includes('settle_order_meetup'))
assert(!start.includes('reservation_expires_at'))
assert(sql.includes('auth.uid() is null'))
assert(sql.includes('o.buyer_id is distinct from auth.uid()'))
assert(start.includes("method is distinct from 'set'"))
assert(sql.includes("old.payment_status in('pending','failed')"))
assert(sql.includes("old.payment_status='processing'"))
assert(sql.includes("(auth.jwt()->>'ref')='pcaqxezdfxofysghssyo'"))
assert(!/create.*(handoff|protection|notification)/i.test(sql))
assert(!sql.includes("status='sold'"))
assert(!sql.includes("lifecycle_status='completed'"))
const inspection = sql
  .split('create function public.marketplace_confirm_campus_inspection')[1]
  .split('end;$$;')[0]
assert(!inspection.includes('update public.orders'))
assert(!inspection.includes('financial_capability'))
assert(inspection.includes('order_money(o.item_amount_cents,0)'))
console.log(
  'PASS immutable applied hashes; V2-only Buyer inspection/payment guards; shared locks; no deadline/provider/handoff/Protection progression'
)
