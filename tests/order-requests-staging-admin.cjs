// Explicit project ref on every DB operation; never use the repository's production link alone.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo',
  version = '202610100001'
const root = path.resolve('tests/artifacts/order-requests-phase1')
const file = 'supabase/migrations/' + version + '_order_requests.sql'
const mode = process.argv[2]
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=')
      return [
        l.slice(0, i),
        l
          .slice(i + 1)
          .trim()
          .replace(/^['"]|['"]$/g, ''),
      ]
    })
)
assert.equal(env.APP_ENV, 'staging')
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
assert.equal(
  spawnSync('git', [
    'check-ignore',
    'tests/artifacts/order-requests-phase1/probe',
  ]).status,
  0
)
fs.mkdirSync(root, { recursive: true })
function cli(args) {
  const r = spawnSync(
    'cmd.exe',
    ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args],
    { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }
  )
  if (r.status) {
    fs.writeFileSync(
      path.join(root, 'cli-diagnostic.txt'),
      r.stderr || r.stdout
    )
    throw Error(
      'Staging CLI failed; details saved only to ignored diagnostic artifact'
    )
  }
  return JSON.parse(
    r.stdout.slice(r.stdout.indexOf(args[0] === 'projects' ? '[' : '{'))
  )
}
const project = cli(['projects', 'list', '--output', 'json']).find(
  (p) => p.ref === ref
)
assert.equal(project.name, 'western-marketplace-staging')
let serial = 0
function query(sql) {
  const f = path.join(root, `operation-${serial++}.sql`)
  fs.writeFileSync(f, sql)
  try {
    return cli([
      'db',
      'query',
      '--linked',
      '--project-ref',
      ref,
      '--file',
      f,
      '--output',
      'json',
    ]).rows
  } finally {
    fs.unlinkSync(f)
  }
}
const history = query(
  'select version from supabase_migrations.schema_migrations order by version'
).map((r) => r.version)
const expected = [
  '202609290001',
  '202610030001',
  '202610040001',
  '202610050001',
  '202610070001',
  '202610070002',
  '202610080001',
  '202610090001',
]
assert.deepEqual(
  history.filter((v) => v !== version),
  expected
)
let sql = fs.readFileSync(file, 'utf8')
assert(!sql.includes('$migration_record$'))
if (mode === 'inspect') {
  const snapshot = query(
    "select (select jsonb_agg(to_jsonb(x)) from information_schema.columns x where table_schema='public' and table_name in ('profiles','listings','listing_images','conversations','messages')) as columns,(select jsonb_agg(to_jsonb(x)) from pg_policies x where schemaname in ('public','realtime')) as policies,(select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','marketplace_private') and p.prokind='f') as functions;"
  )
  const data = JSON.stringify(
    { project: ref, timestamp: new Date().toISOString(), history, snapshot },
    null,
    2
  )
  fs.writeFileSync(path.join(root, 'pre-phase1-schema-snapshot.json'), data)
  fs.writeFileSync(
    path.join(root, 'pre-phase1-schema-sha256.txt'),
    crypto.createHash('sha256').update(data).digest('hex')
  )
  console.log(
    'Staging schema/history snapshot saved in ignored artifacts (schema metadata, not a data backup).'
  )
} else if (mode === 'dry-run') {
  assert(!history.includes(version))
  query(sql.replace(/commit;\s*$/, 'rollback;'))
  console.log(
    'Staging migration transaction executed and rolled back successfully.'
  )
} else if (mode === 'apply') {
  assert(!history.includes(version))
  assert(fs.existsSync(path.join(root, 'pre-phase1-schema-snapshot.json')))
  const digest = crypto.createHash('sha256').update(sql).digest('hex')
  const record = `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','order_requests',ARRAY[$migration_record$${sql}$migration_record$]);\ncommit;`
  query(sql.replace(/commit;\s*$/, record))
  fs.writeFileSync(
    path.join(root, 'applied-manifest.json'),
    JSON.stringify(
      {
        project: ref,
        version,
        sha256: digest,
        appliedAt: new Date().toISOString(),
      },
      null,
      2
    )
  )
  assert.equal(
    query(
      `select count(*) as count from supabase_migrations.schema_migrations where version='${version}'`
    )[0].count,
    1
  )
  console.log(
    'Applied ONLY ' +
      version +
      ' to ' +
      ref +
      ' and recorded migration exactly once.'
  )
} else if (mode === 'verify') {
  console.log(
    JSON.stringify(
      query(
        "select to_regclass('public.orders') as orders,(select count(*) from public.listings where status not in ('available','sold')) as nonstandard_listings,(select count(*) from public.order_requests) as requests,(select count(*) from public.transaction_events) as events,(select count(*) from pg_policies where tablename in ('order_requests','transaction_events')) as policies;"
      )
    )
  )
} else if (mode === 'test') {
  query(fs.readFileSync('tests/order-requests-staging.sql', 'utf8'))
  console.log(
    'Hosted staging Request/RLS/idempotency/schedule tests passed; fixture transaction rolled back.'
  )
} else throw Error('Use inspect/dry-run/apply/verify/test')
