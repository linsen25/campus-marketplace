const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const sql = fs.readFileSync(
  'supabase/migrations/202610120004_offer_accept.sql',
  'utf8'
)
assert.equal(
  crypto
    .createHash('sha256')
    .update(
      fs.readFileSync(
        'supabase/migrations/202610120003_order_snapshot_media.sql'
      )
    )
    .digest('hex'),
  '84ed02dde708f077533907a1cd8019ea122e0bb2322af5db4611b49dab909dbf'
)
for (const text of [
  'order_protocol_version',
  'offer_accept_commands',
  'r.recipient_user_id is distinct from actor',
  'require_seller_payout_ready(r.seller_id)',
  'listing_material_hash_at_offer is null',
  'r.item_amount_cents>l.price_cents',
  'marketplace_private.bind_order_media(p_media_batch,oid)',
  "set status='pending'",
  "set status='closed'",
  'order_protocol_version=1 for update',
  'orders_v2_atomic_commit',
  'reservation_expires_at is null',
])
  assert(sql.includes(text), text)
for (const text of ['12 hours', '60 minutes', 'storage.objects set'])
  assert(!sql.includes(text), text)
const accept = sql.slice(
  sql.indexOf('create function public.marketplace_accept_offer'),
  sql.indexOf('-- Compatibility trigger')
)
assert(
  accept.indexOf('select * into cmd') <
    accept.indexOf('require_seller_payout_ready')
)
assert(
  accept.indexOf('require_seller_payout_ready') <
    accept.indexOf('from public.listings where id=r.listing_id for update')
)
assert(
  accept.indexOf('bind_order_media') < accept.indexOf("set status='accepted'")
)
assert(!accept.includes('payment_method'))
const api = fs.readFileSync('pages/api/offers/[[...segments]].ts', 'utf8')
assert(api.includes("if (action === 'accept') allowed = ['clientActionId']"))
const detail = fs.readFileSync(
  'components/home/formal-v2-order-detail.tsx',
  'utf8'
)
assert(detail.includes('<OrderProgress'))
assert(!/<OrderCountdown|<FormalOrderPayment/.test(detail))
assert(detail.includes('<OrderStageDetails'))
assert(detail.includes('<OrderFlowCancellation'))
const hook = fs.readFileSync('hooks/use-formal-offers.ts', 'utf8')
assert(hook.includes('markAcceptSucceeded'))
assert(hook.includes('accepted.current !== null'))
console.log(
  'PASS C2 protocol, recipient, lock order, idempotency, material/price, atomic private bind, winner and UI boundaries'
)
