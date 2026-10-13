// Staging-only authority checks. Never follows the repository link without exact ref.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/offer-v2-a1')
const version = '202610110004'
const file = `supabase/migrations/${version}_offer_protocol_isolation.sql`
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
const fingerprint = `select 'requests' name,count(*) count,md5(coalesce(string_agg((to_jsonb(t)-array['protocol_version','sender_user_id','recipient_user_id'])::text,'' order by id),'')) hash from public.order_requests t
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
  assert.equal(rows[0].invalid, 0)
  const snapshot =
    query(`begin read only; select p.proname name,pg_get_functiondef(p.oid) definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='marketplace_private' and p.proname in('mutate_order_request','protect_order_request','order_request_event','expire_order_requests'))
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
} else if (['dry-run', 'apply'].includes(mode)) {
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
  if (mode === 'dry-run') query(sql.replace(/commit;\s*$/, 'rollback;'))
  else {
    assert(fs.existsSync(path.join(root, 'dry-run-ok')))
    const hash = crypto.createHash('sha256').update(sql).digest('hex')
    assert.equal(fs.readFileSync(path.join(root, 'dry-run-ok'), 'utf8'), hash)
    query(
      sql.replace(
        /commit;\s*$/,
        `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','offer_protocol_isolation',array[$migration$${sql}$migration$]);commit;`
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
    fs.readFileSync('tests/offer-protocol-staging.sql', 'utf8')
  )
  assert.deepEqual(query(fingerprint), before)
  console.log(
    JSON.stringify({ tests: result, canonicalHistoryUnchanged: true })
  )
} else if (mode === 'verify') {
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
