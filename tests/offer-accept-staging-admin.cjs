// Staging-only authority checks. Never follows the repository link without exact ref.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/offer-accept-c2')
const version = '202610120004'
const file = `supabase/migrations/${version}_offer_accept.sql`
const mode = process.argv[2]
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
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
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
fs.mkdirSync(root, { recursive: true })
function query(sql) {
  const f = path.join(root, 'operation.sql')
  fs.writeFileSync(f, sql)
  try {
    const r = spawnSync(
      'cmd.exe',
      [
        '/d',
        '/c',
        'npx.cmd',
        '--no-install',
        'supabase',
        'db',
        'query',
        '--linked',
        '--project-ref',
        ref,
        '--file',
        f,
        '--output',
        'json',
      ],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }
    )
    if (r.status) {
      fs.writeFileSync(path.join(root, 'diagnostic.txt'), r.stderr || r.stdout)
      throw Error('Staging query failed; details remain in ignored diagnostic')
    }
    return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).rows
  } finally {
    fs.unlinkSync(f)
  }
}

const tables = [
  'public.order_requests',
  'public.orders',
  'public.transaction_events',
  'public.listings',
  'public.listing_images',
  'marketplace_private.offer_commands',
  'marketplace_private.order_commands',
  'marketplace_private.financial_capabilities',
]
const fp = () =>
  query(
    'begin read only;' +
      tables
        .map(
          (t) =>
            `select '${t}' name,count(*) count,md5(coalesce(string_agg((to_jsonb(t)-array['order_protocol_version','listing_snapshot','listing_material_hash_at_offer'])::text,'' order by (to_jsonb(t)-array['order_protocol_version','listing_snapshot','listing_material_hash_at_offer'])::text),'')) hash from ${t} t`
        )
        .join(' union all ') +
      ';rollback;'
  )
const sha = () =>
  crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const history = () =>
  query(
    'select version from supabase_migrations.schema_migrations order by version;'
  ).map((r) => r.version)
;(async () => {
  const r = await fetch('http://localhost:3000'),
    html = await r.text()
  assert.equal(r.status, 200)
  assert(html.includes(ref))
  assert(!html.includes('yzvchumzyonegujucyqs'))
  const prior = {
    '202610110004_offer_protocol_isolation.sql':
      'bea2ce1c4b63c0fed071fddea1fbc1d3998475cf9c63276ac7fbbff02eeac5a7',
    '202610120001_offer_mutations.sql':
      '2bab910d14e5b1ee486731681c928e8e97bbf2feca7f896e6add92f5051d86be',
    '202610120002_offer_final_terms.sql':
      'a25f44a4bff5fb6052a9e6e1d2a56c2c380bd171c2c576a670492607cb668109',
  }
  prior['202610120003_order_snapshot_media.sql'] =
    '84ed02dde708f077533907a1cd8019ea122e0bb2322af5db4611b49dab909dbf'
  for (const [f, h] of Object.entries(prior))
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('supabase/migrations/' + f))
        .digest('hex'),
      h
    )
  if (mode === 'schema') {
    console.log(
      JSON.stringify(
        query(
          "select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid in('public.orders'::regclass,'public.listings'::regclass) order by conname;"
        )
      )
    )
    return
  }
  if (mode === 'inspect') {
    fs.writeFileSync(path.join(root, 'baseline.json'), JSON.stringify(fp()))
    console.log(
      'Staging app/ref guards and applied-file hashes verified; canonical baseline captured'
    )
    return
  }
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'baseline.json')))
  assert.deepEqual(fp(), baseline)
  if (mode === 'dry-run' || mode === 'apply') {
    const applied = history()
    const pending = fs
      .readdirSync('supabase/migrations')
      .filter((f) => f.endsWith('.sql') && !applied.includes(f.split('_')[0]))
    assert.deepEqual(pending, [path.basename(file)])
    let sql = fs.readFileSync(file, 'utf8')
    if (mode === 'dry-run') {
      query(sql.replace(/commit;\s*$/, 'rollback;'))
      fs.writeFileSync(path.join(root, 'dry-run.sha'), sha())
    } else {
      assert.equal(
        fs.readFileSync(path.join(root, 'dry-run.sha'), 'utf8'),
        sha()
      )
      query(
        sql.replace(
          /commit;\s*$/,
          `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','offer_accept',array[$migration$${sql}$migration$]);commit;`
        )
      )
      fs.writeFileSync(
        path.join(root, 'applied.json'),
        JSON.stringify({
          project: ref,
          version,
          sha256: sha(),
          time: new Date().toISOString(),
        })
      )
    }
    console.log(
      JSON.stringify({ mode, only: path.basename(file), sha256: sha() })
    )
  } else if (mode === 'verify') {
    assert.equal(history().filter((v) => v === version).length, 1)
    const b = query(
      "select public from storage.buckets where id='order-snapshot-media';"
    )
    assert.equal(b[0].public, false)
    const grants = query(
      `select count(*) bad from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (p.proname like 'marketplace_%order_media%' or p.proname='bind_order_media') and (has_function_privilege('anon',p.oid,'execute') or(p.proname<>'marketplace_order_snapshot_media' and has_function_privilege('authenticated',p.oid,'execute')));`
    )
    assert.equal(grants[0].bad, 0)
    const authority =
      query(`select p.proname,r.rolname owner,p.prosecdef,p.proconfig,
      has_function_privilege('anon',p.oid,'execute') anon,
      has_function_privilege('authenticated',p.oid,'execute') authenticated
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
      where n.nspname='public' and p.proname in('marketplace_offer_accept_preflight','marketplace_accept_offer');`)
    assert.equal(authority.length, 2)
    for (const row of authority) {
      assert.equal(row.owner, 'postgres')
      assert(row.prosecdef)
      assert(!row.anon)
      assert(row.authenticated)
      assert(row.proconfig.some((c) => c.startsWith('search_path=')))
    }
    const isolation = query(
      `select (select count(*) from public.orders where order_protocol_version<>1 or listing_snapshot is not null) bad, (select count(*) from marketplace_private.offer_accept_commands) journals;`
    )
    assert.equal(isolation[0].bad, 0)
    assert.equal(isolation[0].journals, 0)

    const remaining = query(`select
      (select count(*) from marketplace_private.order_media_batches) +
      (select count(*) from marketplace_private.order_media_commands) +
      (select count(*) from marketplace_private.order_media_assets) +
      (select count(*) from marketplace_private.order_snapshot_media) +
      (select count(*) from storage.objects where bucket_id='order-snapshot-media') as fixtures;`)
    assert.equal(remaining[0].fixtures, 0)
    console.log(
      JSON.stringify({
        syntheticRowsAndObjectsRemaining: 0,
        migrationCount: 1,
        bucketPrivate: true,
        clientPrivilegedRpcDenied: true,
        sha256: sha(),
      })
    )
  } else throw Error('Use inspect/dry-run/apply/verify')
  assert.deepEqual(fp(), baseline)
  console.log('All canonical/manual fingerprints unchanged')
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
