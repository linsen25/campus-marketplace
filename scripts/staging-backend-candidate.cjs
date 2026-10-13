// Additive exact-candidate administration. Never rewrites applied source/history.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const [mode, filename] = process.argv.slice(2)
const revisionPlan = [
  '202610130010_offer_revision_economics.sql',
  '202610130011_offer_revision_domain.sql',
  '202610130012_message_withdrawal.sql',
]
assert(['inventory', 'apply', 'verify'].includes(mode))
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
assert.equal(env.APP_ENV, 'staging')
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
const bin = path.join(
  path.dirname(require.resolve('@supabase/cli-windows-x64/package.json')),
  'bin/supabase.exe'
)
function query(sql) {
  // Migration plus its archival source exceeds Windows' process argument limit.
  // Use an ignored, ephemeral SQL input, with no connection credentials in it.
  const file = path.resolve('tests/artifacts/backend-candidate-operation.sql')
  assert.equal(spawnSync('git', ['check-ignore', file]).status, 0)
  assert(!fs.existsSync(file), 'Do not overwrite another operation')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, sql)
  try {
    const r = spawnSync(
      bin,
      [
        'db',
        'query',
        '--linked',
        '--project-ref',
        ref,
        '--output',
        'json',
        '--file',
        file,
      ],
      { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
    )
    if (r.error || r.status !== 0)
      throw Error(
        'Staging candidate query failed; no connection diagnostics printed'
      )
    return JSON.parse(r.stdout).rows
  } finally {
    fs.unlinkSync(file)
  }
}
function fingerprint() {
  const tables = query(
    "begin read only;select table_schema,table_name from information_schema.tables where table_type='BASE TABLE' and table_schema in('public','marketplace_private') order by 1,2;rollback;"
  )
  const union = tables
    .map((t) => {
      const name = t.table_schema + '.' + t.table_name
      assert(/^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$/.test(name))
      const additiveColumns = {
        'public.listings': ['preferred_fulfillment'],
        'public.order_requests': ['declined_at'],
        'public.messages': ['withdrawn_at'],
        'marketplace_private.offer_commands': ['comparison_offer_id', 'mutation_kind', 'comparison_terms'],
      }
      const omit = revisionPlan.includes(filename) ? additiveColumns[name] || [] : []
      const value = omit.length ? `(to_jsonb(t)-array[${omit.map(quote).join(',')}])` : 'to_jsonb(t)'
      return `select '${name}' name,count(*) count,md5(coalesce(string_agg(${value}::text,'' order by ${value}::text),'')) hash from ${name} t`
    })
    .join(' union all ')
  return query('begin read only;' + union + ';rollback;')
}
const history = query(
  'begin read only;select version from supabase_migrations.schema_migrations order by version;rollback;'
)
const applied = new Set(history.map((r) => r.version))
const pending = fs
  .readdirSync('supabase/migrations')
  .filter((f) => /^\d{12}_.*\.sql$/.test(f) && !applied.has(f.slice(0, 12)))
  .sort()
if (mode === 'inventory') {
  console.log(JSON.stringify({ projectRef: ref, pending }))
  process.exit(0)
}
assert(
  /^\d{12}_[a-z_]+\.sql$/.test(filename),
  'Exact migration filename required'
)
const version = filename.slice(0, 12),
  sql = fs.readFileSync('supabase/migrations/' + filename, 'utf8')
const hash = crypto.createHash('sha256').update(sql).digest('hex')
if (mode === 'verify') {
  const rows = query(
    `begin read only;select count(*) occurrences,bool_and(statements[1]=${quote(
      sql
    )}) source_matches from supabase_migrations.schema_migrations where version='${version}';rollback;`
  )
  assert.equal(rows[0].occurrences, 1)
  assert.equal(rows[0].source_matches, true)
  console.log(
    JSON.stringify({
      filename,
      sha256: hash,
      appliedExactlyOnce: true,
      archivalSourceExact: true,
    })
  )
  process.exit(0)
}
assert.deepEqual(
  pending,
  revisionPlan.includes(filename) ? revisionPlan.filter(f => !applied.has(f.slice(0, 12))) : [filename],
  'Apply requires exactly one pending candidate'
)
assert.equal(pending[0], filename, 'Apply only the next exact candidate in reviewed order')
assert(!applied.has(version), 'Never rewrite an applied migration')
assert(/commit;\s*$/.test(sql))
assert(!sql.includes('$candidate_archive$'))
const before = fingerprint()
const name = filename.slice(13, -4)
// Callback is critical: interpolated $$ in source is not a String.replace token.
const candidate = sql
  .slice(sql.indexOf('begin;'))
  .replace(
    /commit;\s*$/,
    () =>
      `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','${name}',array[$candidate_archive$${sql}$candidate_archive$]);commit;`
  )
query(candidate)
const after = fingerprint()
for (const row of before)
  assert.deepEqual(
    after.find((r) => r.name === row.name),
    row,
    'Canonical/manual table changed: ' + row.name
  )
console.log(
  JSON.stringify({
    filename,
    sha256: hash,
    applied: true,
    existingTablesUnchanged: before.length,
  })
)
function quote(s) {
  return "'" + s.replaceAll("'", "''") + "'"
}
