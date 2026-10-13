// Explicit project ref on every DB operation; never use the repository's production link alone.
const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const settleFixtureRaces = require('./helpers/settle-fixture-races.cjs')
const ref = 'pcaqxezdfxofysghssyo',
  version = '202610100002'
const root = path.resolve('tests/artifacts/order-accept')
const file = 'supabase/migrations/' + version + '_order_accept.sql'
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
  '202610100001',
]
assert.deepEqual(
  history.filter((v) => v !== version),
  expected
)
let sql = fs.readFileSync(file, 'utf8')
assert(!sql.includes('$migration_record$'))

async function raceQuery(body, actor) {
  const f = path.join(root, 'race-' + crypto.randomUUID() + '.sql')
  fs.writeFileSync(
    f,
    "begin;set local role authenticated;select set_config('request.jwt.claims','" +
      JSON.stringify({ sub: actor, role: 'authenticated' }) +
      "',true);create temporary table outcome(ok boolean,code text);do $race$ begin " +
      body +
      ';insert into outcome values(true,null);exception when others then insert into outcome values(false,sqlstate);end;$race$;select * from outcome;commit;'
  )
  try {
    return await new Promise((resolve, reject) => {
      const p = require('node:child_process').spawn(
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
        { windowsHide: true }
      )
      let out = '',
        err = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (err += d))
      p.on('close', (code) => {
        if (code) {
          fs.writeFileSync(path.join(root, 'race-cli-diagnostic.txt'), err)
          return reject(Error('Race CLI failed (no credentials logged).'))
        }
        try {
          resolve(JSON.parse(out.slice(out.indexOf('{'))).rows[0])
        } catch {
          reject(Error('Invalid race result'))
        }
      })
    })
  } finally {
    fs.unlinkSync(f)
  }
}
async function races() {
  const people = query(
    "select (select id from profiles where username='Demo_seller_a') seller,(select id from profiles where username='Demo_buyer_a') buyer,(select id from profiles where username='Demo_buyer_b') other"
  )[0]
  const marker = 'Accept race ' + crypto.randomUUID()
  const fixtures = []
  try {
    for (const kind of ['buyers', 'replace', 'cancel', 'expire']) {
      // Register the scope before the network call: its commit result may be lost.
      const lid = crypto.randomUUID()
      fixtures.push(lid)
      const setup = query(
        "begin;alter table listings disable trigger listings_publication_boundary;insert into listings(id,seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count) select '" +
          lid +
          "',seller_id,'" +
          marker +
          "','Disposable backend-only race fixture',price_cents,currency,category,subcategory,condition,pickup_area,1 from listings where title like '%Nike%' and seller_id='" +
          people.seller +
          "' limit 1;update listings set published_at=now() where title='" +
          marker +
          "' and published_at is null;set constraints all immediate;alter table listings enable trigger listings_publication_boundary;select id from listings where title='" +
          marker +
          "' order by created_at desc limit 1;commit;"
      )[0]
      assert.equal(setup.id, lid)
      const as = (actor, statement) => {
        return query(
          "begin;select set_config('request.jwt.claims','" +
            JSON.stringify({ sub: actor, role: 'authenticated' }) +
            "',true);" +
            statement +
            ';commit;'
        )[0]
      }
      const ca = as(
        people.buyer,
        "select id from marketplace_find_or_create_conversation('" + lid + "')"
      ).id
      const cb = as(
        people.other,
        "select id from marketplace_find_or_create_conversation('" + lid + "')"
      ).id
      const term = JSON.stringify({
        item_amount_cents: 8000,
        fulfillment_type: 'pickup',
        place_name: 'UCC race test',
      })
      const terms =
        "'" +
        term +
        "'::jsonb||jsonb_build_object('scheduled_at',date_trunc('hour',clock_timestamp())+interval '2 days')"
      const ra = as(
        people.seller,
        "select id from marketplace_create_order_request('" +
          ca +
          "'," +
          terms +
          ',gen_random_uuid())'
      ).id
      const rb = as(
        people.seller,
        "select id from marketplace_create_order_request('" +
          cb +
          "'," +
          terms +
          ',gen_random_uuid())'
      ).id
      let results
      const accept =
        "perform marketplace_accept_order_request('" +
        ra +
        "',gen_random_uuid())"
      if (kind === 'buyers')
        results = await settleFixtureRaces([
          raceQuery(accept, people.buyer),
          raceQuery(
            "perform marketplace_accept_order_request('" +
              rb +
              "',gen_random_uuid())",
            people.other
          ),
        ])
      if (kind === 'replace')
        results = await settleFixtureRaces([
          raceQuery(accept, people.buyer),
          raceQuery(
            "perform marketplace_replace_order_request('" +
              ra +
              "'," +
              terms +
              ',gen_random_uuid())',
            people.seller
          ),
        ])
      if (kind === 'cancel')
        results = await settleFixtureRaces([
          raceQuery(accept, people.buyer),
          raceQuery(
            "perform marketplace_cancel_order_request('" +
              ra +
              "','other','Race test',gen_random_uuid())",
            people.seller
          ),
        ])
      if (kind === 'expire') {
        query(
          "begin;alter table order_requests disable trigger order_request_immutable;update order_requests set scheduled_at=now()-interval '1 hour',request_expires_at=now()-interval '1 hour' where id='" +
            ra +
            "';alter table order_requests enable trigger order_request_immutable;commit;"
        )
        results = await settleFixtureRaces([
          raceQuery(accept, people.buyer),
          raceQuery(
            "perform marketplace_order_request_history('" + ca + "')",
            people.seller
          ),
        ])
      }
      assert.equal(
        results.filter((r) => r.ok).length,
        1,
        kind + ' exactly one winner'
      )
      const check = query(
        "select (select count(*) from orders where listing_id='" +
          lid +
          "') orders,(select status from order_requests where id='" +
          ra +
          "') status,(select status from listings where id='" +
          lid +
          "') inventory"
      )[0]
      if (kind === 'buyers') assert.equal(check.orders, 1)
      if (kind === 'expire') {
        assert.equal(check.status, 'expired')
        assert.equal(check.orders, 0)
      }
      console.log(
        'PASS concurrent ' +
          kind +
          ': one winner, Orders=' +
          check.orders +
          ', inventory=' +
          check.inventory
      )
    }
  } finally {
    if (fixtures.length) {
      const ids = fixtures.map((id) => "'" + id + "'").join(',')
      query(
        // Notify before removal, in the same transaction. Delivery occurs after commit;
        // mounted manual sessions refetch the list and discard deleted test rows.
        'begin;lock table listings,orders,order_requests,transaction_events,marketplace_private.order_commands,conversations in access exclusive mode;select marketplace_private.notify_order_history(id) from conversations where listing_id in(' +
          ids +
          ');alter table listings disable trigger user;alter table orders disable trigger user;alter table order_requests disable trigger user;alter table transaction_events disable trigger user;delete from transaction_events where conversation_id in(select id from conversations where listing_id in(' +
          ids +
          '));delete from marketplace_private.order_commands where request_id in(select id from order_requests where listing_id in(' +
          ids +
          "));update listings set status='available',reserved_order_id=null where id in(" +
          ids +
          ") and title='" +
          marker +
          "';delete from orders where listing_id in(" +
          ids +
          ');delete from order_requests where listing_id in(' +
          ids +
          ');delete from conversations where listing_id in(' +
          ids +
          ');delete from listings where id in(' +
          ids +
          ") and title='" +
          marker +
          "';set constraints all immediate;alter table listings enable trigger user;alter table orders enable trigger user;alter table order_requests enable trigger user;alter table transaction_events enable trigger user;commit;"
      )
      assert.equal(
        query(
          "select count(*) count from listings where title='" + marker + "'"
        )[0].count,
        0
      )
      console.log('PASS scoped race fixture cleanup')
    }
  }
}

if (mode === 'race') {
  races().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
} else if (mode === 'inspect') {
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
} else if (mode === 'dry-run' || mode === 'dry-test') {
  assert(!history.includes(version))
  query(
    mode === 'dry-test'
      ? sql.replace(/commit;\s*$/, '') +
          fs
            .readFileSync('tests/order-accept-staging.sql', 'utf8')
            .replace(/^([\s\S]*?)begin;/, '$1')
      : sql.replace(/commit;\s*$/, 'rollback;')
  )
  console.log(
    'Staging migration transaction executed and rolled back successfully.'
  )
} else if (mode === 'apply') {
  assert(!history.includes(version))
  assert(fs.existsSync(path.join(root, 'pre-phase1-schema-snapshot.json')))
  const digest = crypto.createHash('sha256').update(sql).digest('hex')
  const record = `insert into supabase_migrations.schema_migrations(version,name,statements) values('${version}','order_accept',ARRAY[$migration_record$${sql}$migration_record$]);\ncommit;`
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
  assert(history.includes(version))
  console.log(
    JSON.stringify(
      query(
        "select (select count(*) from public.orders) as orders,(select count(*) from public.listings where title like 'Accept race %' or title='Accept rollback fixture') as test_listings_left,(select count(*) from public.listings where status not in ('available','reserved','sold')) as nonstandard_listings,(select count(*) from public.order_requests) as requests,(select count(*) from public.transaction_events) as events,(select count(*) from public.orders where holds_listing and reservation_expires_at<>reservation_started_at+interval '30 minutes') as invalid_deadlines;"
      )
    )
  )
} else if (mode === 'test') {
  query(fs.readFileSync('tests/order-accept-staging.sql', 'utf8'))
  console.log(
    'Hosted staging Request/RLS/idempotency/schedule tests passed; fixture transaction rolled back.'
  )
} else throw Error('Use inspect/dry-run/apply/verify/test')
