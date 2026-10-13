const assert = require('node:assert/strict')
const fs = require('node:fs')
const sql = fs.readFileSync(
  'supabase/migrations/202610100001_order_requests.sql',
  'utf8'
)
assert(sql.startsWith('-- Formal Orders Phase 1'))
assert(/begin;[\s\S]*commit;\s*$/.test(sql))
assert(sql.includes('order_requests_one_active'))
assert(sql.includes('unique(actor_key,action,idempotency_key)'))
for (const name of ['order_requests', 'transaction_events'])
  assert(sql.includes(`alter table public.${name} enable row level security`))
for (const name of ['create', 'replace', 'cancel'])
  assert(sql.includes(`public.marketplace_${name}_order_request`))
assert(sql.includes("'America/Toronto'"))
assert(sql.includes("interval '60 minutes'"))
assert(sql.includes("interval '30 days'"))
assert(sql.includes('extract(minute from local_time)::integer%15'))
assert(sql.includes("cost='pending' then shipping:=null"))
assert(sql.includes('request_expires_at = scheduled_at'))
assert(sql.includes('scheduled_at is null and request_expires_at is null'))
assert(sql.includes("status='active' and request_expires_at <= p_now"))
assert(
  !/create table public.orders|update public.listings|insert into public.messages|marketplace_accept_order_request/.test(
    sql
  )
)
assert(!/grant (insert|update|delete)/i.test(sql))
assert(sql.includes("'messages_changed','marketplace:messages:'"))
console.log('Phase 1 Request migration/static boundaries passed.')
