// Source contract only: never call the scheduler or advance a server clock.
const fs = require('node:fs'),
  assert = require('node:assert/strict')
const read = (name) => fs.readFileSync('supabase/migrations/' + name, 'utf8')
const due = read('202610180001_transaction_scheduler_alias_fix.sql')
for (const text of [
  'pg_try_advisory_xact_lock',
  'due_offer.conversation_id=c.id',
  'marketplace_private.settle_delivery_checkout(row.listing_id)',
  'marketplace_private.settle_order_meetup(row.listing_id)',
  'marketplace_private.settle_order_protection(row.listing_id)',
  'not marketplace_private.external_exchange_started(o.id)',
  'on conflict(source_key) do nothing',
  'suppressed_at=t',
])
  assert(due.includes(text), text)
assert(
  !/\br\.conversation_id\b/.test(due),
  'scheduler alias collision stays fixed'
)
const protection = read('202610130004_handoff_protection.sql')
const settle = protection.slice(
  protection.indexOf(
    'create function marketplace_private.settle_order_protection'
  ),
  protection.indexOf('create function public.marketplace_order_fulfillment')
)
for (const text of [
  "o.payment_status<>'paid'",
  'p.expires_at>t',
  'marketplace_private.protection_cases where order_id=o.id',
  "payout_status='eligible'",
  "status='sold',reserved_order_id=null",
])
  assert(settle.includes(text), text)
console.log(
  'PASS B09 source contracts: due-worker lock/alias/idempotency/external exclusion and mature-unheld Protection. Scheduler/expiry/settlement NOT EXECUTED.'
)
