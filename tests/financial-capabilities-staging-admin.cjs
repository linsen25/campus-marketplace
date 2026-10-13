// Explicit staging target on every operation. Never follows the production link.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const version = '202610100003'
const root = path.resolve('tests/artifacts/financial-capabilities')
const file = `supabase/migrations/${version}_financial_capabilities.sql`
const mode = process.argv[2]
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
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
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
      r.stderr || r.stdout || 'Process failed'
    )
    throw Error(
      'Staging CLI failed; diagnostic saved only in ignored artifacts'
    )
  }
  return JSON.parse(
    r.stdout.slice(r.stdout.indexOf(args[0] === 'projects' ? '[' : '{'))
  )
}
assert.equal(
  cli(['projects', 'list', '--output', 'json']).find((p) => p.ref === ref).name,
  'western-marketplace-staging'
)
function query(sql) {
  const f = path.join(root, 'operation.sql')
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
  '202610100001',
  '202610100002',
]
assert.deepEqual(
  history.filter((v) => v !== version),
  expected
)
const snapshotSQL = `select (select jsonb_agg(to_jsonb(t)) from information_schema.tables t where table_schema in('public','marketplace_private')) tables,
 (select jsonb_agg(jsonb_build_object('name',p.proname,'definition',pg_get_functiondef(p.oid))) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','marketplace_private') and p.prokind='f') functions,
 (select jsonb_agg(to_jsonb(c)) from information_schema.columns c where table_schema='public' and table_name='profiles') profile_columns,
 (select jsonb_agg(to_jsonb(p)) from pg_policies p where schemaname in('public','marketplace_private')) policies`
function fingerprint() {
  return query(`select md5(coalesce((select string_agg(to_jsonb(t)::text,'' order by id) from public.order_requests t),'')) requests,
  md5(coalesce((select string_agg(to_jsonb(t)::text,'' order by id) from public.orders t),'')) orders,
  md5(coalesce((select string_agg(to_jsonb(t)::text,'' order by id) from public.listings t),'')) listings,
  md5(coalesce((select string_agg(to_jsonb(t)::text,'' order by id) from public.profiles t),'')) profiles,
  md5(coalesce((select string_agg(to_jsonb(t)::text,'' order by id) from public.transaction_events t),'')) events`)[0]
}
if (mode === 'inspect') {
  const snapshot = query(snapshotSQL)
  assert(
    !snapshot[0].tables.some((t) =>
      /financial|payment_method|payout_account/.test(t.table_name)
    ),
    'Existing financial schema: STOP'
  )
  fs.writeFileSync(
    path.join(root, 'preflight.json'),
    JSON.stringify({ ref, history, snapshot, fingerprint: fingerprint() })
  )
  console.log(
    JSON.stringify({
      project: ref,
      name: 'western-marketplace-staging',
      history,
      financialSchemaExists: false,
      preflightSaved: true,
    })
  )
} else {
  const sql = fs.readFileSync(file, 'utf8'),
    hash = crypto.createHash('sha256').update(sql).digest('hex')
  const preflight = JSON.parse(
    fs.readFileSync(path.join(root, 'preflight.json'), 'utf8')
  )
  assert.equal(preflight.ref, ref)
  if (mode === 'dry-test') {
    assert(!history.includes(version))
    query(
      sql.replace(/commit;\s*$/, '') +
        fs
          .readFileSync('tests/financial-capabilities-staging.sql', 'utf8')
          .replace(/^begin;/, '')
    )
    fs.writeFileSync(path.join(root, 'reviewed-sha256.txt'), hash)
    console.log(
      'PASS additive migration + security tests; entire transaction rolled back. SHA256 ' +
        hash
    )
  } else if (mode === 'apply') {
    assert(!history.includes(version))
    assert.equal(
      fs.readFileSync(path.join(root, 'reviewed-sha256.txt'), 'utf8'),
      hash
    )
    assert.deepEqual(
      fingerprint(),
      preflight.fingerprint,
      'Manual data changed since preflight: STOP'
    )
    query(
      sql.replace(
        /commit;\s*$/,
        `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','financial_capabilities',ARRAY[$migration_record$${sql}$migration_record$]);commit;`
      )
    )
    fs.writeFileSync(
      path.join(root, 'applied-manifest.json'),
      JSON.stringify({
        ref,
        version,
        sha256: hash,
        appliedAt: new Date().toISOString(),
      })
    )
    console.log('Applied ONLY ' + version + ' to ' + ref + '; SHA256 ' + hash)
  } else if (mode === 'test' || mode === 'verify') {
    assert.equal(history.filter((v) => v === version).length, 1)
    if (mode === 'test')
      query(fs.readFileSync('tests/financial-capabilities-staging.sql', 'utf8'))
    assert.deepEqual(
      fingerprint(),
      preflight.fingerprint,
      'Manual fixtures must remain unchanged'
    )
    const rows = query(
      'select count(*) count from marketplace_private.financial_capabilities'
    )
    assert.equal(rows[0].count, 0, 'No persistent financial fixtures')
    const current = query(snapshotSQL)[0]
    for (const before of preflight.snapshot[0].functions)
      assert.deepEqual(
        current.functions.find(
          (f) => f.name === before.name && f.definition === before.definition
        ),
        before,
        'Existing RPC definition must remain unchanged: ' + before.name
      )
    const grants =
      query(`select c.relrowsecurity rls,pg_get_userbyid(c.relowner) owner,
      has_table_privilege('authenticated',c.oid,'SELECT') client_select,
      has_table_privilege('authenticated',c.oid,'INSERT,UPDATE,DELETE') client_write,
      has_function_privilege('authenticated','public.marketplace_financial_capabilities()','EXECUTE') own_read,
      has_function_privilege('anon','public.marketplace_financial_capabilities()','EXECUTE') anon_read,
      has_function_privilege('authenticated','public.marketplace_financial_capabilities_for_user(uuid)','EXECUTE') other_read,
      has_function_privilege('authenticated','public.marketplace_record_financial_capability(uuid,text,text,text,text,text,text,text)','EXECUTE') client_mutate,
      has_function_privilege('service_role','public.marketplace_record_financial_capability(uuid,text,text,text,text,text,text,text)','EXECUTE') trusted_mutate
      from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='marketplace_private' and c.relname='financial_capabilities'`)[0]
    assert(grants.rls && grants.own_read && grants.trusted_mutate)
    for (const k of [
      'client_select',
      'client_write',
      'anon_read',
      'other_read',
      'client_mutate',
    ])
      assert.equal(grants[k], false)
    fs.writeFileSync(
      path.join(root, 'verification.json'),
      JSON.stringify({
        grants,
        unchangedExistingFunctions: true,
        unchangedManualFixtures: true,
        financialRows: 0,
      })
    )
    console.log(
      'PASS migration recorded once, rollback security tests/unchanged manual fixtures, zero financial rows'
    )
  } else throw Error('Use inspect/dry-test/apply/test/verify')
}
