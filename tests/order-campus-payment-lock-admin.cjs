// Staging-only authority checks. Never follows the repository link without exact ref.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/campus-d2a-lock')
const version = '202610120010'
const file = `supabase/migrations/${version}_order_campus_payment_lock.sql`
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
  'public.order_meetup_revisions',
  'marketplace_private.meetup_commands',
  'marketplace_private.meetup_expiries',
  'public.order_requests',
  'public.orders',
  'public.transaction_events',
  'public.listings',
  'public.listing_images',
  'marketplace_private.offer_commands',
  'marketplace_private.order_commands',
  'marketplace_private.financial_capabilities',
  'marketplace_private.order_media_batches',
  'marketplace_private.order_media_commands',
  'marketplace_private.order_media_assets',
  'marketplace_private.order_snapshot_media',
]
const fp = () =>
  query(
    'begin read only;' +
      tables
        .map(
          (t) =>
            `select '${t}' name,count(*) count,md5(coalesce(string_agg((to_jsonb(t))::text,'' order by (to_jsonb(t))::text),'')) hash from ${t} t`
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
  prior['202610120004_offer_accept.sql'] =
    '7141e92183ba407861f0cd6e32af19be7ec854020c08d4c31a89114cbc4db370'
  prior['202610120003_order_snapshot_media.sql'] =
    '84ed02dde708f077533907a1cd8019ea122e0bb2322af5db4611b49dab909dbf'
  prior['202610120005_order_meetup.sql'] =
    'efc126a2a3f336007cf129de7c8a345c072eb9ea6e09ad66b035e4e87d9f6a6a'
  prior['202610120006_order_meetup_guard.sql'] =
    'e6927b32a89e2b86f984593bb6d28f512e8341fe733ad9c8c9dabfa736bbcc30'
  prior['202610120007_order_meetup_retention.sql'] =
    'd5f635840da81b3be228b2a619c9552d6a66e0d21ed1bac6e6dc85ef40233a8e'
  prior['202610120008_order_campus_payment.sql'] =
    '9ee979c206dfb290268250e91718013a86b74ddbe84be890b4563127552362eb'
  prior['202610120009_order_campus_paid_inventory.sql'] =
    '6d0eab0a08093f88e8475d49b48c9e4ece065d9567d63f87704ec34e277ab9ff'
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
      JSON.stringify(
        query(
          'select order_protocol_version protocol,count(*) count from public.orders group by order_protocol_version;'
        )
      )
    )
    console.log(
      'Staging app/ref guards and applied-file hashes verified; canonical/media baseline captured'
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
          `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','order_campus_payment',array[$migration$${sql}$migration$]);commit;`
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
    if (fs.existsSync(path.join(root, 'applied.json')))
      assert.equal(
        JSON.parse(fs.readFileSync(path.join(root, 'applied.json'), 'utf8'))
          .sha256,
        sha()
      )
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
      where n.nspname='public' and p.proname in('marketplace_campus_payment_state','marketplace_confirm_campus_inspection','marketplace_start_campus_payment');`)
    assert.equal(authority.length, 3)
    for (const row of authority) {
      assert.equal(row.owner, 'postgres')
      assert(row.prosecdef)
      assert(!row.anon)
      assert(row.authenticated)
      assert(row.proconfig.some((c) => c.startsWith('search_path=')))
    }
    assert.equal(
      query(
        "select count(*) bad from pg_proc where proname='marketplace_resolve_campus_payment' and (has_function_privilege('anon',oid,'execute') or has_function_privilege('authenticated',oid,'execute') or not has_function_privilege('service_role',oid,'execute'));"
      )[0].bad,
      0
    )
    assert.equal(
      query(
        'select (select count(*) from marketplace_private.campus_inspections)+(select count(*) from marketplace_private.campus_payment_attempts) fixtures;'
      )[0].fixtures,
      0
    )
    const isolation = query(
      `select (select count(*) from public.orders where order_protocol_version<>1 or listing_snapshot is not null) bad, (select count(*) from marketplace_private.offer_accept_commands) journals;`
    )
    assert.equal(isolation[0].bad, 0)
    assert.equal(isolation[0].journals, 0)

    const hygiene =
      query(`select (select count(*) from auth.users where email like 'd1meetup_%@uwo.ca') users,
      (select count(*) from pg_trigger where not tgisinternal and tgname in('order_meetup_guard','order_meetup_event','orders_meetup_terminal','orders_immutable','orders_event') and tgenabled<>'O') disabled;`)[0]
    assert.equal(hygiene.users, 0)
    assert.equal(hygiene.disabled, 0)
    const remaining = query(`select
      (select count(*) from public.order_meetup_revisions) +
      (select count(*) from marketplace_private.meetup_commands) +
      (select count(*) from marketplace_private.meetup_expiries) +
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
