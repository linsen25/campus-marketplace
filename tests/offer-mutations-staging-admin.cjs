// Staging-only authority checks. Never follows the repository link without exact ref.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/offer-v2-a2')
const version = '202610120001'
const file = `supabase/migrations/${version}_offer_mutations.sql`
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
const fingerprint = `select 'requests' name,count(*) count,md5(coalesce(string_agg((to_jsonb(t)-array['withdrawn_at','withdrawn_by','withdrawal_note','closed_at'])::text,'' order by id),'')) hash from public.order_requests t
union all select 'orders',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.orders t
union all select 'events',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.transaction_events t
union all select 'listings',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from public.listings t
union all select 'commands',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by id),'')) from marketplace_private.order_commands t
union all select 'capabilities',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) from marketplace_private.financial_capabilities t;`
const valid = `select count(*) total,count(*) filter(where c.id is null or r.seller_origin_id is null or r.buyer_origin_id is null or r.seller_origin_id=r.buyer_origin_id or r.listing_origin_id is distinct from c.listing_origin_id
or(c.seller_id is not null and c.seller_id is distinct from r.seller_origin_id) or(c.buyer_id is not null and c.buyer_id is distinct from r.buyer_origin_id)
or(r.seller_id is not null and r.seller_id is distinct from r.seller_origin_id) or(r.buyer_id is not null and r.buyer_id is distinct from r.buyer_origin_id)) invalid
from public.order_requests r left join public.conversations c on c.id=r.conversation_id;`
if (mode === 'inspect') {
  const rows = query('begin read only;' + valid + 'rollback;')
  fs.writeFileSync(
    path.join(root, 'constraints.json'),
    JSON.stringify(
      query(
        `select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid in('public.order_requests'::regclass,'public.transaction_events'::regclass,'marketplace_private.order_commands'::regclass);`
      )
    )
  )
  assert.equal(rows[0].invalid, 0)
  const snapshot =
    query(`begin read only; select p.proname name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='marketplace_private' and p.proname in('mutate_order_request','protect_order_request','order_request_event','prepare_request_protocol_identity','require_seller_payout_ready'))
or(n.nspname='public' and p.proname in('marketplace_accept_order_request','marketplace_order_request_history'));rollback;`)
  fs.writeFileSync(path.join(root, 'functions.json'), JSON.stringify(snapshot))
  fs.writeFileSync(
    path.join(root, 'before.json'),
    JSON.stringify(query('begin read only;' + fingerprint + 'rollback;'))
  )
  fs.writeFileSync(
    path.join(root, 'history.json'),
    JSON.stringify(
      query(
        'select version from supabase_migrations.schema_migrations order by version;'
      )
    )
  )
  console.log(
    JSON.stringify({
      stagingRef: ref,
      legacy: rows[0],
      functions: snapshot.map((x) => x.name),
    })
  )
} else if (['dry-run', 'apply', 'pretest'].includes(mode)) {
  assert(fs.existsSync(path.join(root, 'before.json')))
  const history = query(
    'select version from supabase_migrations.schema_migrations order by version;'
  )
  assert.deepEqual(
    history,
    JSON.parse(fs.readFileSync(path.join(root, 'history.json')))
  )
  assert(!history.some((x) => x.version === version))
  assert.equal(query(valid)[0].invalid, 0)
  assert.deepEqual(
    query(fingerprint),
    JSON.parse(fs.readFileSync(path.join(root, 'before.json')))
  )
  const sql = fs.readFileSync(file, 'utf8')
  if (mode === 'pretest')
    query(
      sql.replace(/commit;\s*$/, '') +
        fs
          .readFileSync('tests/offer-mutations-staging.sql', 'utf8')
          .replace(/^.*?begin;/s, '')
    )
  else if (mode === 'dry-run') query(sql.replace(/commit;\s*$/, 'rollback;'))
  else {
    assert(fs.existsSync(path.join(root, 'dry-run-ok')))
    const hash = crypto.createHash('sha256').update(sql).digest('hex')
    assert.equal(fs.readFileSync(path.join(root, 'dry-run-ok'), 'utf8'), hash)
    query(
      sql.replace(
        /commit;\s*$/,
        `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','offer_mutations',array[$migration$${sql}$migration$]);commit;`
      )
    )
    fs.writeFileSync(
      path.join(root, 'applied.json'),
      JSON.stringify({
        ref,
        version,
        sha256: hash,
        time: new Date().toISOString(),
      })
    )
  }
  assert.deepEqual(
    query(fingerprint),
    JSON.parse(fs.readFileSync(path.join(root, 'before.json')))
  )
  if (mode === 'dry-run')
    fs.writeFileSync(
      path.join(root, 'dry-run-ok'),
      crypto.createHash('sha256').update(sql).digest('hex')
    )
  console.log(`${mode}: ONLY ${file}; original historical fields unchanged`)
} else if (mode === 'test') {
  const before = query(fingerprint)
  const result = query(
    fs.readFileSync('tests/offer-mutations-staging.sql', 'utf8')
  )
  assert.deepEqual(query(fingerprint), before)
  console.log(
    JSON.stringify({ tests: result, canonicalHistoryUnchanged: true })
  )
} else if (mode === 'verify') {
  assert.equal(
    query('select count(*) count from marketplace_private.offer_commands;')[0]
      .count,
    0,
    'Synthetic Offer command cleanup'
  )

  const unchanged = [
    'mutate_order_request',
    'marketplace_accept_order_request',
    'marketplace_order_request_history',
    'require_seller_payout_ready',
  ]
  const original = JSON.parse(
    fs.readFileSync(path.join(root, 'functions.json'), 'utf8')
  ).filter((x) => unchanged.includes(x.name))
  const current = query(
    `select p.proname name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace where (n.nspname='marketplace_private' and p.proname in('mutate_order_request','require_seller_payout_ready')) or(n.nspname='public' and p.proname in('marketplace_accept_order_request','marketplace_order_request_history'));`
  )
  assert.deepEqual(
    current.sort((a, b) => a.name.localeCompare(b.name)),
    original.sort((a, b) => a.name.localeCompare(b.name))
  )
  const privileges = query(
    `select p.proname name,p.prosecdef definer,p.proconfig config,pg_get_userbyid(p.proowner) owner,has_function_privilege('anon',p.oid,'EXECUTE') anon,has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,n.nspname schema from pg_proc p join pg_namespace n on n.oid=p.pronamespace where p.proname in('mutate_offer','emit_offer_event','marketplace_create_offer','marketplace_withdraw_offer','marketplace_offer_history');`
  )
  assert.equal(privileges.length, 5)
  for (const p of privileges) {
    assert.equal(p.definer, true)
    assert.equal(p.owner, 'postgres')
    assert.equal(p.anon, false)
    assert.equal(p.authenticated, p.schema === 'public')
    assert(p.config.some((x) => /^search_path=(?:"")?$/.test(x)))
  }

  assert.deepEqual(
    query(fingerprint),
    JSON.parse(fs.readFileSync(path.join(root, 'before.json')))
  )
  console.log(
    JSON.stringify(
      query(`select count(*) total,count(*) filter(where protocol_version<>1 or sender_user_id<>seller_origin_id or recipient_user_id<>buyer_origin_id) invalid,
      (select count(*) from supabase_migrations.schema_migrations where version='${version}') migration_count from public.order_requests;`)
    )
  )
} else throw Error('Use inspect / dry-run / apply / test / verify')
