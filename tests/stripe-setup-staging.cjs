// Target-guarded schema qualification. Never contacts Stripe or manual samples.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const filename = '202610160004_stripe_account_setup.sql',
  version = '202610160004'
const source = fs.readFileSync('supabase/migrations/' + filename, 'utf8')
const sha = crypto.createHash('sha256').update(source).digest('hex')
const body = source
  .replace(/^[\s\S]*?\bbegin;\s*/, '')
  .replace(/commit;\s*$/, '')
const tables = [
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
const before = fingerprint()
const applied = h.query(
  `begin read only;select statements[1] source from supabase_migrations.schema_migrations where version='${version}';rollback;`
)
if (applied.length)
  assert.equal(applied[0].source, source, 'Never rewrite applied migration')
if (process.argv.includes('--apply')) {
  assert(!applied.length, 'Never reapply/rewrite migration')
  h.query(
    `begin;set local lock_timeout='10s';${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values('${version}','stripe_account_setup',array[${h.q(
      source
    )}]);commit;select true applied;`
  )
  console.log('Applied staging-only', filename, 'SHA256', sha)
} else {
  const rows = h.query(
    "begin;set local lock_timeout='10s';" +
      (applied.length ? '' : body) +
      '\n' +
      fs.readFileSync('tests/stripe-setup-staging.sql', 'utf8') +
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
