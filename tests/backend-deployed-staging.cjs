// Read-only live source/grants/job verification with an explicit staging ref.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      let i = l.indexOf('=')
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
      'begin read only;' + sql + 'rollback;',
    ],
    { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }
  )
  assert.equal(r.status, 0, 'Explicit staging read-only query')
  return JSON.parse(r.stdout).rows
}
const files = fs
    .readdirSync('supabase/migrations')
    .filter((f) => f.startsWith('20261013'))
    .sort(),
  expected = new Map(),
  hashes = []
for (const file of files) {
  const sql = fs.readFileSync('supabase/migrations/' + file, 'utf8')
  hashes.push({
    file,
    sha256: crypto.createHash('sha256').update(sql).digest('hex'),
  })
  for (const m of sql.matchAll(
    /create(?: or replace)? function ([a-z_.]+)\([\s\S]*?as \$\$([\s\S]*?)\$\$;/gi
  ))
    expected.set(m[1], {
      body: m[2].replaceAll('\r\n', '\n').trim(),
      definer: /security definer/i.test(m[0].slice(0, m[0].indexOf('as $$'))),
    })
}
const names = [...expected.keys()].map((n) => "'" + n + "'").join(',')
const functions = query(
  `select n.nspname||'.'||p.proname name,p.prosrc,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname in(${names});`
)
assert.equal(functions.length, expected.size)
for (const f of functions) {
  const wanted = expected.get(f.name)
  assert.equal(
    f.prosrc.replaceAll('\r\n', '\n').trim(),
    wanted.body,
    'Live body differs: ' + f.name
  )
  assert.equal(f.prosecdef, wanted.definer)
  assert(
    f.proconfig?.includes('search_path=""'),
    'Empty search_path: ' + f.name
  )
}
const history = query(
  "select version,count(*) n,min(encode(sha256(convert_to(statements[1],'UTF8')),'hex')) archival_sha from supabase_migrations.schema_migrations where version like '20261013%' group by version;"
)
assert.equal(history.length, files.length)
assert(history.every((r) => r.n === 1))
for (const row of history)
  assert.equal(
    row.archival_sha,
    hashes.find((h) => h.file.startsWith(row.version)).sha256,
    'Archival bytes must match candidate SHA'
  )
const privateTables = query(
  "select c.relname,c.relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='marketplace_private' and c.relname in('notification_events','notification_reminders','v2_order_economics','delivery_checkouts','handoff_key','handoff_authorizations','order_protection','protection_cases','courier_shipments','courier_commands','buyer_receipt_commands','campus_inspections','campus_payment_attempts');"
)
assert.equal(privateTables.length, 13)
assert(privateTables.every((t) => t.relrowsecurity))
const job = query(
  "select schedule,active,command from cron.job where jobname='marketplace-v2-transaction-due-work';"
)
assert.equal(job.length, 1)
assert.equal(job[0].schedule, '* * * * *')
assert.equal(
  job[0].command,
  'select marketplace_private.run_transaction_due_work();'
)
console.log(
  JSON.stringify({
    migrationHashes: hashes,
    appliedExactlyOnce: true,
    liveBodiesVerified: functions.length,
    emptySearchPaths: true,
    privateRlsTables: 13,
    schedulerActive: job[0].active,
  })
)
