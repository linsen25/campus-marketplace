// Real independent staging transactions; no canonical fixture or application changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/order-cancellation-concurrency')
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
const marker = 'Cancellation concurrency ' + crypto.randomUUID()
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
async function fingerprint() {
  return query(
    tables
      .map(
        (t) =>
          `select '${t}' name,count(*) count,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${t} t`
      )
      .join(' union all ')
  )
}
async function fixture(deadline) {
  const lid = crypto.randomUUID()
  listings.push(lid)
  journal()
  // Publication exception is scoped to fixture setup transaction, restored before commit.
  await query(`begin;set local lock_timeout='10s';alter table public.listings disable trigger listings_publication_boundary;
    insert into public.listings(id,seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at)
    select '${lid}','${seller}',${q(
    marker
  )},'Synthetic concurrency fixture',8000,currency,category,subcategory,condition,pickup_area,1,clock_timestamp() from public.listings where published_at is not null limit 1;
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
  const oid = (
    await query(
      `begin;${actor(
        buyer
      )}select id from public.marketplace_accept_order_request('${rid}',gen_random_uuid());commit;`
    )
  )[0].id
  if (deadline) {
    // Synthetic row only. Trigger bypass lasts only this transaction, no DDL/global changes.
    await query(`begin;set local session_replication_role=replica;with t as(select clock_timestamp()+interval '${deadline}' deadline)
      update public.orders set created_at=t.deadline-interval '30 minutes',accepted_at=t.deadline-interval '30 minutes',reservation_started_at=t.deadline-interval '30 minutes',reservation_expires_at=t.deadline
      from t where id='${oid}' and listing_id='${lid}' and buyer_id='${buyer}' and seller_id='${seller}';commit;`)
  }
  return { lid, cid, rid, oid }
}
function operation(kind, f, tag, delay, key) {
  const identity =
    kind === 'cancel'
      ? actor(buyer)
      : kind === 'payment'
      ? `set local role service_role;select set_config('request.jwt.claims','{"role":"service_role","ref":"${ref}"}',true);`
      : ''
  const call =
    kind === 'cancel'
      ? `insert into outcome select public.marketplace_cancel_order('${f.oid}','other','Original concurrent reason','${key}'),null,null`
      : kind === 'payment'
      ? `insert into outcome select public.marketplace_simulate_order_payment_success('${f.oid}','${buyer}','${key}'),null,null`
      : `perform marketplace_private.settle_listing_reservation('${f.lid}');insert into outcome values('{}',null,null)`
  return `begin;set local application_name='${tag}';set local lock_timeout='30s';set local statement_timeout='45s';
    create temporary table outcome(result jsonb,sqlstate text,message text);grant all on outcome to authenticated,service_role;
    ${identity}do $test$ begin ${call};exception when others then insert into outcome values(null,sqlstate,sqlerrm);end;$test$;
    reset role;${
      delay ? `select pg_sleep(${delay});` : ''
    }select *,pg_backend_pid() pid,txid_current() xid from outcome;commit;`
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
function checkResponse(row) {
  if (row.sqlstate === '40P01') report.deadlocks++
  if (row.sqlstate === '55P03') report.lockTimeouts++
  if (row.sqlstate === '57014') report.statementTimeouts++
  assert.equal(row.sqlstate, null, row.message || 'No SQL exception')
}
async function race(caseName, firstKind, secondKind, round) {
  const f = await fixture(
    caseName === 'expiry-first'
      ? '-1 second'
      : caseName === 'cancel-before-expiry'
      ? '8 seconds'
      : null
  )
  const key = crypto.randomUUID()
  const tag = 'cancelrace_' + crypto.randomUUID().replaceAll('-', '')
  const first = query(operation(firstKind, f, tag + '_a', 12, key))
  const held = await observe(tag + '_a', 'sleep')
  const second = query(
    operation(
      secondKind,
      f,
      tag + '_b',
      0,
      caseName === 'duplicate' ? key : crypto.randomUUID()
    )
  )
  const waiting = await observe(tag + '_b', 'lock')
  assert.notEqual(held.pid, waiting.pid)
  assert.notEqual(held.xid, waiting.xid)
  assert(
    waiting.blockers.includes(held.pid),
    'Loser is directly blocked by uncommitted winner'
  )
  const responses = (await Promise.all([first, second])).map((rows) => rows[0])
  responses.forEach(checkResponse)
  const state = (
    await query(`select o.lifecycle_status,o.payment_status,o.holds_listing,o.cancelled_at,o.cancelled_by_role,o.cancel_reason_code,o.cancel_reason_label_snapshot,o.cancel_note,o.expired_at,
    r.status request_status,l.status inventory,l.reserved_order_id,
    (select count(*) from public.transaction_events where order_id=o.id and event_type='order_cancelled') cancellations,
    (select count(*) from public.transaction_events where order_id=o.id and event_type='payment_paid') payments,
    (select count(*) from public.transaction_events where order_id=o.id and event_type='reservation_expired') expiries,
    (select count(*) from marketplace_private.order_commands where order_id=o.id and action='cancel_order') cancel_commands
    from public.orders o join public.listings l on l.id=o.listing_id join public.order_requests r on r.id=o.request_id where o.id='${f.oid}'`)
  )[0]
  try {
    assert.equal(state.request_status, 'accepted')
    assert.equal(state.cancellations + state.payments + state.expiries, 1)
    const winner =
      firstKind === 'payment'
        ? 'paid'
        : firstKind === 'expiry'
        ? 'expired'
        : 'cancelled'
    if (winner === 'paid') {
      assert.equal(state.lifecycle_status, 'open')
      assert.equal(state.payment_status, 'paid')
      assert.equal(state.holds_listing, true)
      assert.equal(state.inventory, 'reserved')
      assert.equal(state.reserved_order_id, f.oid)
      assert.equal(state.payments, 1)
      assert.equal(responses[1].result.errorCode, 'order_not_cancellable')
    } else {
      assert.equal(state.lifecycle_status, winner)
      assert.equal(state.payment_status, 'pending')
      assert.equal(state.holds_listing, false)
      assert.equal(state.inventory, 'available')
      assert.equal(state.reserved_order_id, null)
      if (winner === 'expired') {
        assert.equal(state.expiries, 1)
        assert.equal(responses[1].result.errorCode, 'order_not_cancellable')
      } else {
        assert.equal(state.cancellations, 1)
        assert.equal(state.cancel_commands, 1)
        assert.equal(state.cancelled_by_role, 'buyer')
        assert.equal(state.cancel_reason_code, 'other')
        assert.equal(state.cancel_reason_label_snapshot, 'Other')
        assert.equal(state.cancel_note, 'Original concurrent reason')
        assert(state.cancelled_at)
        assert.equal(state.expired_at, null)
        if (secondKind === 'payment')
          assert.equal(responses[1].result.errorCode, 'order_not_payment_ready')
        if (caseName === 'duplicate')
          assert.deepEqual(responses[0].result.order, responses[1].result.order)
      }
    }
    if (winner !== 'cancelled')
      for (const field of [
        'cancelled_at',
        'cancelled_by_role',
        'cancel_reason_code',
        'cancel_reason_label_snapshot',
        'cancel_note',
      ])
        assert.equal(state[field], null)
    report.results.push({
      case: caseName,
      round,
      winner,
      overlap: { holder: held, waiter: waiting },
      responses,
      state,
    })
    fs.writeFileSync(
      path.join(root, 'results.json'),
      JSON.stringify(report, null, 2)
    )
    console.log(
      `PASS ${caseName} round ${round}: independent transactions, verified lock wait, ${winner}, one terminal event`
    )
  } catch (e) {
    report.invariantFailures++
    throw e
  }
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
async function main() {
  journal()
  const before = await fingerprint()
  const triggers = await query(
    'select oid,tgenabled from pg_trigger where not tgisinternal order by oid'
  )
  fs.writeFileSync(
    path.join(root, 'before.json'),
    JSON.stringify({ before, triggers }, null, 2)
  )
  try {
    await query(`begin;insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values ${users
      .map(
        (id) =>
          `('${id}','cancelrace_${id}@uwo.ca',clock_timestamp(),jsonb_build_object('username','Race_${id
            .replaceAll('-', '')
            .slice(0, 12)}'))`
      )
      .join(',')};
      select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test','${marker}','race_payout','Test Bank','6789');
      select public.marketplace_record_financial_capability('${buyer}','payment_method','set','staging_test','${marker}','race_method','Test Card','4242');commit;`)
    for (let round = 1; round <= report.repetitions; round++) {
      for (const [name, first, second] of [
        ['cancel-before-payment', 'cancel', 'payment'],
        ['payment-first', 'payment', 'cancel'],
        ['cancel-before-expiry', 'cancel', 'expiry'],
        ['expiry-first', 'expiry', 'cancel'],
        ['duplicate', 'cancel', 'cancel'],
      ])
        await race(name, first, second, round)
    }
  } finally {
    await cleanup()
    assert.deepEqual(
      await fingerprint(),
      before,
      'Canonical graph including Nike/capabilities/messages unchanged'
    )
    assert.deepEqual(
      await query(
        'select oid,tgenabled from pg_trigger where not tgisinternal order by oid'
      ),
      triggers,
      'Trigger restoration'
    )
    const residue = (
      await query(
        `select (select count(*) from auth.users where id in(${ids(
          users
        )})) users,(select count(*) from public.profiles where id in(${ids(
          users
        )})) profiles,(select count(*) from public.listings where seller_id='${seller}') listings,(select count(*) from public.orders where buyer_id='${buyer}' or seller_id='${seller}') orders,(select count(*) from public.order_requests where buyer_id='${buyer}' or seller_id='${seller}') requests,(select count(*) from marketplace_private.financial_capabilities where user_id in(${ids(
          users
        )})) capabilities`
      )
    )[0]
    Object.values(residue).forEach((v) => assert.equal(v, 0))
    report.cleanup = {
      canonicalFingerprintsUnchanged: true,
      triggersRestored: true,
      residue,
    }
    fs.writeFileSync(
      path.join(root, 'results.json'),
      JSON.stringify(report, null, 2)
    )
    fs.unlinkSync(path.join(root, 'scope.json'))
    console.log(
      'PASS cleanup: synthetic graph removed; canonical/Nike/capability fingerprints unchanged; triggers restored'
    )
  }
  assert.equal(report.results.length, 15)
  console.log(
    JSON.stringify({
      runs: report.results.length,
      deadlocks: report.deadlocks,
      lockTimeouts: report.lockTimeouts,
      statementTimeouts: report.statementTimeouts,
      invariantFailures: report.invariantFailures,
      complete: true,
    })
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
