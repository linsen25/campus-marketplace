const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const version = '202610160009',
  file = 'supabase/migrations/' + version + '_message_shop_provenance.sql'
const source = fs.readFileSync(file, 'utf8'),
  sha = crypto.createHash('sha256').update(source).digest('hex')
const body = source
  .replace(/^[\s\S]*?\bbegin;\s*/, '')
  .replace(/commit;\s*$/, '')
const envHash = () =>
  ['.env.local', '.env.staging.local'].map((f) =>
    crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')
  )
const envBefore = envHash()
const tables = [
  'public.conversations',
  'public.messages',
  'public.shops',
  'public.orders',
  'public.listings',
  'public.order_requests',
  'public.transaction_events',
  'public.profiles',
  'auth.users',
  'storage.objects',
  'public.notifications',
  'marketplace_private.conversation_first_contacts',
]
const fingerprint = () =>
  h.query(
    tables
      .map(
        (t) =>
          `select '${t}' name,count(*) n,md5(coalesce(string_agg((to_jsonb(x)-array['listing_channel_snapshot','shop_name_snapshot'])::text,'' order by (to_jsonb(x)-array['listing_channel_snapshot','shop_name_snapshot'])::text),'')) hash from ${t} x`
      )
      .join(' union all ')
  )
const before = fingerprint()
const applied = h.query(
  `select statements[1] source from supabase_migrations.schema_migrations where version='${version}'`
)
if (applied.length) assert.equal(applied[0].source, source)
if (process.argv.includes('--apply')) {
  assert(!applied.length, 'Do not reapply')
  h.query(
    `begin;set local lock_timeout='10s';${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values('${version}','message_shop_provenance',array[${h.q(
      source
    )}]);commit;select true applied;`
  )
  console.log('Applied staging pcaqxezdfxofysghssyo', version)
} else {
  const rows = h.query(
    `begin;set local lock_timeout='10s';${
      applied.length ? '' : body
    }\n${fs.readFileSync(
      'tests/message-shop-provenance-staging.sql',
      'utf8'
    )}\nrollback;`
  )
  assert(rows.some((r) => r.result?.startsWith('PASS')))
  console.log(rows.filter((r) => r.result))
}
assert.deepEqual(
  fingerprint(),
  before,
  'No historical changes or retained fixtures'
)
assert.deepEqual(envHash(), envBefore)
if (applied.length || process.argv.includes('--apply')) {
  assert.equal(
    h.query(
      "select prosrc from pg_proc where oid='marketplace_private.protect_conversation_identity()'::regprocedure"
    )[0].prosrc,
    source.match(/as \$\$([\s\S]*?)\$\$;/i)[1]
  )
  const bodies = [...source.matchAll(/as \$\$([\s\S]*?)\$\$;/gi)]
  assert.equal(
    h.query(
      "select prosrc from pg_proc where oid='public.marketplace_find_or_create_conversation(uuid)'::regprocedure"
    )[0].prosrc,
    bodies[1][1]
  )
  assert.deepEqual(
    h.query(
      "select column_name,is_nullable from information_schema.columns where table_schema='public' and table_name='conversations' and column_name in('listing_channel_snapshot','shop_name_snapshot') order by column_name"
    ),
    [
      { column_name: 'listing_channel_snapshot', is_nullable: 'YES' },
      { column_name: 'shop_name_snapshot', is_nullable: 'YES' },
    ]
  )
  assert.equal(
    h.query(
      `select count(*)::int n from supabase_migrations.schema_migrations where version='${version}'`
    )[0].n,
    1
  )
  assert.equal(
    h.query(
      'select count(*)::int n from public.conversations where listing_channel_snapshot is not null or shop_name_snapshot is not null'
    )[0].n,
    0,
    'No historical backfill'
  )
  console.log(
    'PASS exact deployed function, nullable columns, single ledger entry, historical NULL fields'
  )
}
console.log(
  'PASS full fingerprints/env unchanged, all fixtures rolled back; SHA256',
  sha
)
