// Explicit staging-only administration; diagnostics never print credentials.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/order-cancellation')
const values = Object.fromEntries(
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
assert.equal(values.APP_ENV, 'staging')
assert.equal(values.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
fs.mkdirSync(root, { recursive: true })
function query(sql) {
  const file = path.join(root, 'query.sql')
  fs.writeFileSync(file, sql)
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
        file,
        '--output',
        'json',
      ],
      { encoding: 'utf8', windowsHide: true, maxBuffer: 20 * 1024 * 1024 }
    )
    if (r.status) {
      fs.writeFileSync(path.join(root, 'diagnostic.txt'), r.stderr || r.stdout)
      throw Error('Staging query failed; diagnostic is ignored')
    }
    return JSON.parse(r.stdout.slice(r.stdout.indexOf('{'))).rows
  } finally {
    fs.unlinkSync(file)
  }
}
const fingerprint = () =>
  query(`select md5(coalesce((select string_agg((to_jsonb(o)-array['cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])::text,'' order by id) from public.orders o),'')) orders,
 md5(coalesce((select string_agg(to_jsonb(r)::text,'' order by id) from public.order_requests r),'')) requests,
 md5(coalesce((select string_agg(to_jsonb(l)::text,'' order by id) from public.listings l),'')) listings,
 md5(coalesce((select string_agg(to_jsonb(c)::text,'' order by user_id,capability) from marketplace_private.financial_capabilities c),'')) capabilities,
 md5(coalesce((select string_agg(to_jsonb(e)::text,'' order by id) from public.transaction_events e),'')) events`)[0]
const mode = process.argv[2]
if (mode === 'audit') {
  const state = fingerprint()
  fs.writeFileSync(
    path.join(root, 'protected-before.json'),
    JSON.stringify(state, null, 2)
  )
  const orders = query(
    `select o.id,o.request_id,l.title,o.lifecycle_status,o.payment_status,o.reservation_expires_at from public.orders o join public.listings l on l.id=o.listing_id order by o.created_at`
  )
  console.log(
    JSON.stringify(
      {
        project: ref,
        orders,
        constraints: query(
          "select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='public.orders'::regclass"
        ),
        versions: query(
          'select version from supabase_migrations.schema_migrations order by version'
        ),
      },
      null,
      2
    )
  )
} else if (mode === 'inspect') {
  console.log(
    JSON.stringify(
      query(
        "select o.id,o.lifecycle_status,o.payment_status,o.expired_at,o.cancelled_at,l.status listing_status,(select jsonb_agg(jsonb_build_object('type',event_type,'at',created_at)) from public.transaction_events where order_id=o.id) events from public.orders o join public.listings l on l.id=o.listing_id order by o.created_at"
      ),
      null,
      2
    )
  )
} else if (mode === 'verify') {
  assert.deepEqual(
    fingerprint(),
    JSON.parse(fs.readFileSync(path.join(root, 'protected-before.json')))
  )
  console.log(
    'All existing Orders/Requests/Listings/capabilities/events unchanged'
  )
} else if (mode === 'test') {
  const before = fingerprint()
  query(fs.readFileSync('tests/order-cancellation-staging.sql', 'utf8'))
  assert.deepEqual(fingerprint(), before)
  console.log('Rollback cancellation tests passed; all existing data unchanged')
} else if (mode === 'dry-run') {
  const versions = query(
    'select version from supabase_migrations.schema_migrations order by version'
  ).map((x) => x.version)
  const pending = fs
    .readdirSync('supabase/migrations')
    .filter(
      (x) => /^\d+_.*\.sql$/.test(x) && !versions.includes(x.split('_')[0])
    )
  assert.deepEqual(pending, ['202610110003_order_cancellation.sql'])
  const before = fingerprint()
  query(
    fs
      .readFileSync('supabase/migrations/' + pending[0], 'utf8')
      .replace(/commit;\s*$/i, 'rollback;')
  )
  assert.deepEqual(fingerprint(), before)
  console.log(
    'ONLY 202610110003_order_cancellation.sql; transactional dry-run rolled back successfully'
  )
} else if (mode === 'apply') {
  const file = 'supabase/migrations/202610110003_order_cancellation.sql'
  const sql = fs.readFileSync(file, 'utf8')
  const versions = query(
    'select version from supabase_migrations.schema_migrations order by version'
  ).map((x) => x.version)
  assert(!versions.includes('202610110003'))
  assert.equal(versions.at(-1), '202610110002')
  const pending = fs
    .readdirSync('supabase/migrations')
    .filter(
      (x) => /^\d+_.*\.sql$/.test(x) && !versions.includes(x.split('_')[0])
    )
  assert.deepEqual(pending, [path.basename(file)])
  const before = fingerprint()
  query(
    sql.replace(
      /commit;\s*$/i,
      "insert into supabase_migrations.schema_migrations(version,name,statements) values('202610110003','order_cancellation',array[$migration$" +
        sql +
        '$migration$]); commit;'
    )
  )
  assert.deepEqual(fingerprint(), before)
  console.log(
    JSON.stringify({
      applied: '202610110003',
      sha256: crypto.createHash('sha256').update(sql).digest('hex'),
      existingDataUnchanged: true,
    })
  )
} else throw Error('Use audit, apply, test or verify')
module.exports = { query, fingerprint, root }
