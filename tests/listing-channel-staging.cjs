const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const file = 'supabase/migrations/202610160007_listing_channel_authority.sql'
const source = fs.readFileSync(file, 'utf8')
const hash = (file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const environmentBefore = ['.env.local', '.env.staging.local'].map(hash)
const tables = [
  'public.listings',
  'public.shops',
  'public.profiles',
  'auth.users',
  'public.orders',
  'public.order_requests',
  'public.conversations',
  'public.messages',
  'public.transaction_events',
  'public.listing_favorites',
  'storage.objects',
  'marketplace_private.account_activity_events',
  'public.notifications',
  'marketplace_private.notification_deliveries',
]
const fingerprint = () =>
  h.query(
    tables
      .map(
        (t) =>
          `select '${t}' name,count(*) n,md5(coalesce(string_agg((to_jsonb(x)-'listing_channel')::text,'' order by (to_jsonb(x)-'listing_channel')::text),'')) hash from ${t} x`
      )
      .join(' union all ')
  )
const before = fingerprint()
const deployed = process.argv.includes('--deployed')
const body = deployed
  ? ''
  : source.slice(source.indexOf('begin;') + 6).replace(/commit;\s*$/, '')
const factory = fs
  .readFileSync('tests/dual-payment-staging.sql', 'utf8')
  .split('create function pg_temp.dual_agree')[0]
const results = h.query(
  'begin;\n' +
    body +
    '\n' +
    factory +
    '\n' +
    fs.readFileSync('tests/listing-channel-staging.sql', 'utf8') +
    '\nrollback;'
)
assert(results.some((row) => row.result?.startsWith('PASS')))
assert.deepEqual(
  fingerprint(),
  before,
  'all persisted fixture/transaction/media/event rows unchanged'
)
assert.deepEqual(
  ['.env.local', '.env.staging.local'].map(hash),
  environmentBefore
)
if (!deployed)
  assert.equal(
    h.query(
      "select not exists(select 1 from information_schema.columns where table_schema='public' and table_name='listings' and column_name='listing_channel') absent"
    )[0].absent,
    true
  )
console.log(results.filter((row) => row.result))
console.log(
  'PASS staging pcaqxezdfxofysghssyo rollback-only channel qualification; no retained synthetic user/Shop/Listing/Order/media/notifications; environment files unchanged'
)
