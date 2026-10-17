// Target-guarded schema qualification. Never contacts Stripe or manual samples.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const filename = '202610160008_order_shop_provenance.sql',
  version = '202610160008'
const source = fs.readFileSync('supabase/migrations/' + filename, 'utf8')
const sha = crypto.createHash('sha256').update(source).digest('hex')
const body = source
  .replace(/^[\s\S]*?\bbegin;\s*/, '')
  .replace(/commit;\s*$/, '')
const tables = [
  'public.shops',
  'public.listings',
  'public.orders',
  'public.order_requests',
  'public.transaction_events',
  'public.conversations',
  'public.messages',
  'public.listing_favorites',
  'auth.users',
  'public.profiles',
  'storage.objects',
  'marketplace_private.financial_capabilities',
]
const fingerprint = () =>
  h.query(
    'begin read only;' +
      tables
        .map(
          (t) =>
            `select '${t}' name,count(*) n,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) hash from ${t} x`
        )
        .join(' union all ') +
      ';rollback;'
  )
const environmentBefore = ['.env.local', '.env.staging.local'].map((file) =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
)
const columns = () =>
  h.query(
    "select column_name,data_type,is_nullable,column_default from information_schema.columns where table_schema='public' and table_name='orders' order by ordinal_position"
  )
const columnsBefore = columns()
const before = fingerprint()
const applied = h.query(
  `begin read only;select statements[1] source from supabase_migrations.schema_migrations where version='${version}';rollback;`
)
if (applied.length)
  assert.equal(applied[0].source, source, 'Never rewrite applied migration')
if (process.argv.includes('--apply')) {
  assert(!applied.length, 'Never reapply/rewrite migration')
  h.query(
    `begin;set local lock_timeout='10s';${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values('${version}','order_shop_provenance',array[${h.q(
      source
    )}]);commit;select true applied;`
  )
  console.log('Applied staging-only', filename, 'SHA256', sha)
} else {
  const rows = h.query(
    "begin;set local lock_timeout='10s';" +
      (applied.length ? '' : body) +
      '\n' +
      fs.readFileSync(
        process.argv.includes('--financial')
          ? 'tests/order-shop-provenance-flow-staging.sql'
          : process.argv.includes('--regression')
          ? 'tests/dual-payment-staging.sql'
          : 'tests/order-shop-provenance-staging.sql',
        'utf8'
      ) +
      '\nrollback;'
  )
  assert(rows.some((r) => r.result?.startsWith('PASS')))
  console.log(rows.find((r) => r.result).result)
}
assert.deepEqual(
  fingerprint(),
  before,
  'Canonical/manual data unchanged, all synthetic rows rolled back'
)
console.log('PASS fingerprints, no residual synthetic data; SHA256', sha)

assert.deepEqual(columns(), columnsBefore, 'No Order columns changed')
assert.deepEqual(
  ['.env.local', '.env.staging.local'].map((file) =>
    crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  ),
  environmentBefore
)
if (process.argv.includes('--apply') || applied.length) {
  const expected = [
    source.match(/as \$\$([\s\S]*?)\$\$;/i)[1],
    source.match(/AS \$function\$([\s\S]*?)\$function\$;/)[1],
  ]
  const names = [
    'public.marketplace_accept_offer(uuid,uuid,uuid)',
    'public.marketplace_accept_order_request(uuid,uuid)',
  ]
  names.forEach((name, i) =>
    assert.equal(
      h.query(
        `select prosrc from pg_proc where oid=${h.q(name)}::regprocedure`
      )[0].prosrc,
      expected[i],
      'Deployed function matches exact local source'
    )
  )
  assert.equal(
    h.query(
      `select count(*)::int n from supabase_migrations.schema_migrations where version='${version}'`
    )[0].n,
    1
  )
  console.log(
    'PASS migration ledger once, exact deployed function bodies, unchanged Order columns/environment'
  )
}
