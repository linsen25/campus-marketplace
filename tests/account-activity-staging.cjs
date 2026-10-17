const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const h = require('../scripts/v2-maintenance-staging.cjs')
const filename = '202610160003_account_activity.sql',
  version = '202610160003',
  source = fs.readFileSync('supabase/migrations/' + filename, 'utf8'),
  sha = crypto.createHash('sha256').update(source).digest('hex')
const body = source.replace(/^begin;\s*/, '').replace(/commit;\s*$/, '')
const fingerprints = () =>
  h.query(
    'begin read only;' +
      [
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
      ]
        .map(
          (t) =>
            `select '${t}' name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${t} t`
        )
        .join(' union all ') +
      ';rollback;'
  )
const before = fingerprints()
const applied =
  h.query(
    `begin read only;select version from supabase_migrations.schema_migrations where version='${version}';rollback;`
  ).length > 0
if (applied) {
  const receipt = h.query(
    `begin read only;select statements[1] source from supabase_migrations.schema_migrations where version='${version}';rollback;`
  )
  assert.equal(
    receipt[0].source,
    source,
    'Applied migration source remains byte-identical'
  )
}
if (process.argv.includes('--apply')) {
  assert(!applied, 'Never rewrite applied migration')
  h.query(
    `begin;set local lock_timeout='15s';${body}\ninsert into supabase_migrations.schema_migrations(version,name,statements)values('${version}','account_activity',array[${h.q(
      source
    )}]);commit;select true applied;`
  )
  console.log(
    'Applied staging pcaqxezdfxofysghssyo ' + filename + ' SHA256 ' + sha
  )
} else {
  const rows = h.query(
    "begin;set local lock_timeout='15s';" +
      (applied ? '' : body) +
      '\n' +
      fs.readFileSync('tests/account-activity-staging.sql', 'utf8') +
      '\nrollback;'
  )
  assert(rows.some((r) => r.result?.startsWith('PASS')))
  console.log(rows.find((r) => r.result).result)
}
assert.deepEqual(
  fingerprints(),
  before,
  'Canonical/manual/schema-adjacent data unchanged'
)
console.log(
  'PASS fingerprints unchanged; rollback leaves no fixtures; production untouched'
)
