const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const sql = fs.readFileSync(
  'supabase/migrations/202610120001_offer_mutations.sql',
  'utf8'
)
assert.equal(
  crypto
    .createHash('sha256')
    .update(
      fs.readFileSync(
        'supabase/migrations/202610110004_offer_protocol_isolation.sql'
      )
    )
    .digest('hex'),
  'bea2ce1c4b63c0fed071fddea1fbc1d3998475cf9c63276ac7fbbff02eeac5a7'
)
for (const part of [
  'marketplace_create_offer',
  'marketplace_withdraw_offer',
  'marketplace_offer_history',
  'offer_commands',
  'V2 mutation authority required',
  'V2 creation authority required',
  'ACTIVE_PROPOSAL_PROTOCOL_CONFLICT',
  'offer_created',
  'offer_replaced',
  'offer_withdrawn',
])
  assert(sql.includes(part))
assert(
  !/create(?: or replace)? function public\.marketplace_accept_offer/i.test(sql)
)
assert(
  !/insert into public\.orders|update public\.listings|settle_listing_reservation|expire_order_requests/i.test(
    sql
  )
)
assert(sql.includes("p_action='create' and actor=c.seller_id"))
assert(
  sql.indexOf('select * into cmd from marketplace_private.offer_commands') <
    sql.indexOf('require_seller_payout_ready(actor)')
)
assert(sql.includes('prior.sender_user_id is distinct from actor'))
assert(sql.includes("prior.status<>'active'"))
assert(sql.includes('protocol_version=2'))
assert(sql.includes("'messages_changed','marketplace:messages:'"))
assert(!/grant (insert|update|delete)|drop table|drop column/i.test(sql))
assert(sql.includes('revoke all on marketplace_private.offer_commands'))
assert(sql.includes("set search_path=''"))
console.log(
  'PASS A2 additive migration / A1 checksum / sender payout / command authority / safe lifecycle / no Accept-Order-Listing-timers'
)
