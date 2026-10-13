// Real independent staging transactions; no canonical fixture or application changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/offer-protocol-concurrency')
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
const { spawnSync } = require('node:child_process')
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
fs.mkdirSync(root, { recursive: true })
const users = [crypto.randomUUID(), crypto.randomUUID()]
const [seller, buyer] = users
const marker = 'A1 concurrency ' + crypto.randomUUID()
const listings = []
const report = {
  project: ref,
  repetitions: 3,
  results: [],
  deadlocks: 0,
  lockTimeouts: 0,
  statementTimeouts: 0,
  invariantFailures: 0,
}
const pending = new Set()
const q = (v) => "'" + v.replaceAll("'", "''") + "'"
const ids = (values) => values.map(q).join(',')
function journal() {
  fs.writeFileSync(
    path.join(root, 'scope.json'),
    JSON.stringify({ users, listings, marker }, null, 2)
  )
}
function query(sql) {
  const file = path.join(root, crypto.randomUUID() + '.sql')
  fs.writeFileSync(file, sql)
  const work = new Promise((resolve, reject) => {
    const proc = spawn(
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
      { windowsHide: true }
    )
    let out = '',
      err = ''
    proc.stdout.on('data', (d) => {
      out += d
    })
    proc.stderr.on('data', (d) => {
      err += d
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (code) {
        fs.writeFileSync(file + '.diagnostic', err || out)
        return reject(Error('Staging query failed; see ignored diagnostic'))
      }
      try {
        resolve(JSON.parse(out.slice(out.indexOf('{'))).rows)
      } catch (e) {
        reject(e)
      }
    })
  }).finally(() => {
    fs.unlinkSync(file)
  })
  pending.add(work)
  work.then(
    () => pending.delete(work),
    () => pending.delete(work)
  )
  return work
}
function actor(id) {
  return `set local role authenticated;select set_config('request.jwt.claims',${q(
    JSON.stringify({ sub: id, role: 'authenticated' })
  )},true);`
}
const tables = [
  'auth.users',
  'public.profiles',
  'public.listings',
  'public.conversations',
  'public.messages',
  'public.listing_favorites',
  'public.order_requests',
  'public.orders',
  'public.transaction_events',
  'marketplace_private.order_commands',
  'marketplace_private.financial_capabilities',
]
// Browser regression sign-ins may update Auth activity timestamps. Preserve every
// other Auth field; all transaction/profile/Listing/capability fields compare exactly.
async function fingerprint() {
  return query(
    tables
      .map(
        (t) =>
          `select '${t}' name,count(*) count,md5(coalesce(string_agg(${
            t === 'auth.users'
              ? "(to_jsonb(t)-array['last_sign_in_at','updated_at'])"
              : 'to_jsonb(t)'
          }::text,'' order by ${
            t === 'auth.users'
              ? "(to_jsonb(t)-array['last_sign_in_at','updated_at'])"
              : 'to_jsonb(t)'
          }::text),'')) hash from ${t} t`
      )
      .join(' union all ')
  )
}
async function observe(tag, type) {
  for (let i = 0; i < 8; i++) {
    const rows = await query(
      `select pid,backend_xid::text xid,wait_event,wait_event_type,pg_blocking_pids(pid) blockers from pg_stat_activity where application_name='${tag}' and pid<>pg_backend_pid()`
    )
    if (
      rows[0] &&
      (type === 'sleep'
        ? rows[0].wait_event === 'PgSleep'
        : rows[0].wait_event_type === 'Lock')
    )
      return rows[0]
    await new Promise((r) => setTimeout(r, 100))
  }
  throw Error('Actual overlap barrier not observed: ' + tag + ' ' + type)
}
async function cleanup() {
  await Promise.allSettled([...pending])
  if (listings.length) {
    const set = ids(listings)
    // Retention guards bypassed only under exclusive locks, only exact journal-owned graph.
    await query(`begin;set local lock_timeout='10s';
      lock table public.listings,public.orders,public.order_requests,public.transaction_events,marketplace_private.order_commands,public.conversations in access exclusive mode;
      do $$begin if exists(select 1 from public.listings where id in(${set}) and (seller_id<>'${seller}' or title<>${q(
      marker
    )})) then raise exception 'Fixture identity mismatch';end if;
        if exists(select 1 from public.order_requests where listing_id not in(${set}) and replacement_request_id in(select id from public.order_requests where listing_id in(${set})))
        or exists(select 1 from public.listings where id not in(${set}) and reserved_order_id in(select id from public.orders where listing_id in(${set}))) then raise exception 'External reference';end if;end$$;
      alter table public.transaction_events disable trigger transaction_events_immutable;
      alter table public.orders disable trigger orders_immutable;
      alter table public.order_requests disable trigger order_request_immutable;
      alter table public.listings disable trigger listings_inventory_guard;
      alter table public.listings disable trigger listings_publication_boundary;
      delete from public.transaction_events where request_id in(select id from public.order_requests where listing_id in(${set}));
      delete from marketplace_private.order_commands where request_id in(select id from public.order_requests where listing_id in(${set}));
      update public.listings set status='available',reserved_order_id=null where id in(${set});
      delete from public.orders where listing_id in(${set});delete from public.order_requests where listing_id in(${set});
      delete from public.conversations where listing_id in(${set});delete from public.listings where id in(${set}) and seller_id='${seller}' and title=${q(
      marker
    )};
      set constraints all immediate;
      alter table public.transaction_events enable trigger transaction_events_immutable;
      alter table public.orders enable trigger orders_immutable;
      alter table public.order_requests enable trigger order_request_immutable;
      alter table public.listings enable trigger listings_inventory_guard;
      alter table public.listings enable trigger listings_publication_boundary;
      delete from marketplace_private.financial_capabilities where user_id in(${ids(
        users
      )});
      delete from auth.users where id in(${ids(users)});commit;`)
  } else
    await query(
      `begin;delete from marketplace_private.financial_capabilities where user_id in(${ids(
        users
      )});delete from auth.users where id in(${ids(users)});commit;`
    )
}

async function fixture() {
  const lid = crypto.randomUUID()
  listings.push(lid)
  journal()
  await query(`begin;alter table public.listings disable trigger listings_publication_boundary;
 insert into public.listings(id,seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
 select '${lid}','${seller}',${q(
    marker
  )},'A1 synthetic concurrency',8000,currency,category,subcategory,condition,pickup_area,1,clock_timestamp() from public.listings where published_at is not null limit 1;
 set constraints all immediate;alter table public.listings enable trigger listings_publication_boundary;commit;`)
  const cid = (
    await query(
      `begin;${actor(
        buyer
      )}select id from public.marketplace_find_or_create_conversation('${lid}');commit;`
    )
  )[0].id
  const rid = (
    await query(
      `begin;${actor(
        seller
      )}select id from public.marketplace_create_order_request('${cid}','{"item_amount_cents":8000,"fulfillment_type":"shipping","shipping_cost_mode":"included"}',gen_random_uuid());commit;`
    )
  )[0].id
  await query(
    `begin;${actor(
      seller
    )}select public.marketplace_cancel_order_request('${rid}','other','Template',gen_random_uuid());commit;`
  )
  return { lid, cid, rid }
}
function operation(version, f, tag, delay) {
  const call =
    version === 1
      ? `insert into outcome select id,protocol_version,null from public.marketplace_create_order_request('${f.cid}','{"item_amount_cents":7000,"fulfillment_type":"shipping","shipping_cost_mode":"included"}',gen_random_uuid());`
      : `insert into public.order_requests select (jsonb_populate_record(null::public.order_requests,to_jsonb(r)||jsonb_build_object('id',gen_random_uuid(),'protocol_version',2,'sender_user_id',null,'recipient_user_id',null,'status','active','cancelled_at',null,'cancelled_by',null,'cancelled_by_role',null,'cancel_reason_code',null,'cancel_reason_label_snapshot',null,'cancel_note',null,'created_at',clock_timestamp(),'updated_at',clock_timestamp()))).* from public.order_requests r where id='${f.rid}';insert into outcome select id,protocol_version,null from public.order_requests where conversation_id='${f.cid}' and status='active';`
  return `begin;set local application_name='${tag}';set local lock_timeout='30s';set local statement_timeout='45s';create temporary table outcome(id uuid,version int,sqlstate text);grant all on outcome to authenticated;
 ${
   version === 1
     ? actor(seller)
     : `select set_config('request.jwt.claims','{"sub":"${buyer}","role":"authenticated"}',true);`
 }
 do $test$ begin ${call} exception when others then insert into outcome values(null,null,sqlstate);end;$test$;
 reset role;${
   delay ? `select pg_sleep(${delay});` : ''
 }select *,pg_backend_pid() pid,txid_current() xid from outcome;commit;`
}
async function race(firstVersion, round) {
  const f = await fixture(),
    tag = 'a1race_' + crypto.randomUUID().replaceAll('-', '')
  const first = query(operation(firstVersion, f, tag + '_a', 12))
  const held = await observe(tag + '_a', 'sleep')
  const second = query(operation(3 - firstVersion, f, tag + '_b', 0))
  const wait = await observe(tag + '_b', 'lock')
  assert.notEqual(held.pid, wait.pid)
  assert.notEqual(held.xid, wait.xid)
  assert(wait.blockers.includes(held.pid), 'Actual concurrent lock barrier')
  const [a, b] = await Promise.all([first, second])
  for (const r of [a[0], b[0]]) {
    if (r.sqlstate === '40P01') report.deadlocks++
    if (r.sqlstate === '55P03') report.lockTimeouts++
    if (r.sqlstate === '57014') report.statementTimeouts++
  }
  assert.equal(a[0].sqlstate, null)
  assert.equal(b[0].sqlstate, '23505')
  const state = (
    await query(`select (select count(*) from public.order_requests where conversation_id='${f.cid}' and status='active') active,
 (select protocol_version from public.order_requests where conversation_id='${f.cid}' and status='active') version,
 (select count(*) from public.orders where conversation_id='${f.cid}') orders,
 (select count(*) from public.transaction_events where conversation_id='${f.cid}') events,
 (select count(*) from marketplace_private.order_commands where request_id in(select id from public.order_requests where conversation_id='${f.cid}')) commands,
 status inventory from public.listings where id='${f.lid}';`)
  )[0]
  assert.equal(state.active, 1)
  assert.equal(state.version, firstVersion)
  assert.equal(state.orders, 0)
  assert.equal(state.inventory, 'available')
  assert.equal(state.events, firstVersion === 1 ? 3 : 2)
  assert.equal(state.commands, firstVersion === 1 ? 3 : 2)
  report.results.push({
    firstVersion,
    round,
    state,
    holder: held,
    waiter: wait,
  })
  console.log(
    `PASS round ${round} V${firstVersion} winner: independent transactions, observed blocker, one Active, no partial loser writes`
  )
}
async function main() {
  journal()
  const before = await fingerprint()
  try {
    await query(
      `begin;insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ${users
        .map(
          (id) =>
            `('${id}','a1race_${id}@uwo.ca',clock_timestamp(),jsonb_build_object('username','A1Race_${id
              .replaceAll('-', '')
              .slice(0, 12)}'))`
        )
        .join(
          ','
        )};select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test',${q(
        marker
      )},'a1_race','Test Bank','6789');commit;`
    )
    for (let round = 1; round <= 3; round++)
      for (const v of [1, 2]) await race(v, round)
  } finally {
    await cleanup()
    assert.deepEqual(
      await fingerprint(),
      before,
      'Exact canonical graph after fixture cleanup'
    )
    report.cleanup = true
    fs.writeFileSync(
      path.join(root, 'results.json'),
      JSON.stringify(report, null, 2)
    )
  }
  console.log(
    JSON.stringify({
      runs: report.results.length,
      deadlocks: report.deadlocks,
      lockTimeouts: report.lockTimeouts,
      statementTimeouts: report.statementTimeouts,
      cleanup: report.cleanup,
    })
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
