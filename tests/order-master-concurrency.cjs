// Observed overlapping independent staging transactions; exact synthetic journal only.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { query, q, root } = require('./order-master-staging-query.cjs')
const journalFile = path.join(root, 'concurrency-scope.json')
const baselineFile = path.join(root, 'concurrency-baseline.json')
const uuid = () => crypto.randomUUID()
const actor = (id) =>
  `select set_config('request.jwt.claims',${q(
    JSON.stringify({ sub: id, role: 'authenticated' })
  )},true);`
const tables = [
  'public.listings',
  'public.listing_images',
  'public.conversations',
  'public.messages',
  'public.listing_favorites',
  'public.order_requests',
  'public.orders',
  'public.transaction_events',
]
const fingerprint = () =>
  query(
    'begin read only;' +
      tables
        .map(
          (table) =>
            `select ${q(
              table
            )} name,count(*) n,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${table} t`
        )
        .join(' union all ') +
      ';rollback;'
  )
let scope
async function cleanup() {
  if (!scope) return
  assert(scope.marker.startsWith('master-race-'))
  assert(
    scope.people.length === 3 &&
      scope.orders.every(
        (o) => scope.people.includes(o.buyer) && scope.people.includes(o.seller)
      )
  )
  if (!scope.orders.length)
    scope.orders = await query(
      `begin read only;select id,buyer_id buyer,seller_id seller,case when terms_snapshot->'terms'->>'fulfillment'='on_campus' then 'on_campus' else 'seller_delivery' end mode from public.orders where buyer_id in(${scope.people
        .map(q)
        .join(',')}) and seller_id in(${scope.people
        .map(q)
        .join(',')});rollback;`
    )
  const ids = scope.orders.map((o) => q(o.id)).join(',') || 'null',
    people = scope.people.map(q).join(',')
  const owned = await query(
    `begin read only;select count(*) n from public.orders where id in(${ids}) and buyer_id in(${people}) and seller_id in(${people});rollback;`
  )
  assert.equal(
    Number(owned[0].n),
    scope.orders.length,
    'Exact fixture ownership required'
  )
  let sql = `begin;set local lock_timeout='20s';create temp table master_scope as select * from public.orders where id in(${ids});
  alter table public.order_meetup_revisions disable trigger order_meetup_guard;
  alter table marketplace_private.v2_order_economics disable trigger v2_order_economics_immutable;
  alter table public.transaction_events disable trigger transaction_events_immutable;
  alter table public.orders disable trigger orders_immutable;
  alter table public.order_requests disable trigger order_request_immutable;
  alter table public.listings disable trigger listings_publication_boundary;
  alter table public.listings disable trigger listings_inventory_guard;
  delete from public.notifications where recipient_user_id in(${people});
  delete from marketplace_private.notification_reminders where order_id in(${ids});
  delete from marketplace_private.notification_events where destination->>'orderId' in(select id::text from master_scope)
   or destination->>'offerId' in(select request_id::text from master_scope)
   or destination->>'conversationId' in(select conversation_id::text from master_scope);`
  for (const table of [
    'order_flow_commands',
    'order_settlement_authorizations',
    'order_cancellation_intents',
    'seller_delivery_starts',
    'buyer_receipt_commands',
    'courier_commands',
    'courier_shipments',
    'protection_cases',
    'order_protection',
    'handoff_authorizations',
    'delivery_checkouts',
    'campus_payment_attempts',
    'campus_inspections',
    'meetup_commands',
    'meetup_expiries',
  ])
    sql += `delete from marketplace_private.${table} where order_id in(${ids});`
  sql += `delete from marketplace_private.v2_order_economics where order_id in(${ids});
  delete from public.order_meetup_revisions where order_id in(${ids});
  delete from marketplace_private.order_snapshot_media where order_id in(${ids});
  set local storage.allow_delete_query='true';
  delete from storage.objects where bucket_id='order-snapshot-media' and split_part(name,'/',1) in(select id::text from marketplace_private.order_media_batches where listing_id in(select listing_id from master_scope));
  delete from marketplace_private.order_media_commands where batch_id in(select id from marketplace_private.order_media_batches where listing_id in(select listing_id from master_scope));
  delete from marketplace_private.order_media_assets where batch_id in(select id from marketplace_private.order_media_batches where listing_id in(select listing_id from master_scope));
  delete from marketplace_private.order_media_batches where listing_id in(select listing_id from master_scope);
  delete from marketplace_private.offer_accept_commands where order_id in(${ids});
  delete from public.transaction_events where order_id in(${ids}) or request_id in(select request_id from master_scope);
  delete from marketplace_private.offer_commands where offer_id in(select request_id from master_scope);
  delete from marketplace_private.order_commands where order_id in(${ids});
  update public.listings set status='available',reserved_order_id=null where id in(select listing_id from master_scope);
  delete from public.orders where id in(${ids});
  delete from public.order_requests where id in(select request_id from master_scope);
  delete from public.conversations where id in(select conversation_id from master_scope);
  delete from public.listings where id in(select listing_id from master_scope);
  delete from auth.users where id in(${people});
  set constraints all immediate;
  alter table public.order_meetup_revisions enable trigger order_meetup_guard;
  alter table marketplace_private.v2_order_economics enable trigger v2_order_economics_immutable;
  alter table public.transaction_events enable trigger transaction_events_immutable;
  alter table public.orders enable trigger orders_immutable;
  alter table public.order_requests enable trigger order_request_immutable;
  alter table public.listings enable trigger listings_publication_boundary;
  alter table public.listings enable trigger listings_inventory_guard;
  set constraints all immediate;commit;select true as cleaned;`
  await query(sql)
  const remains = await query(
    `begin read only;select (select count(*) from auth.users where id in(${people})) users,(select count(*) from public.orders where id in(${ids})) orders;rollback;`
  )
  assert(Object.values(remains[0]).every((v) => Number(v) === 0))
  assert.deepEqual(
    await fingerprint(),
    JSON.parse(fs.readFileSync(baselineFile, 'utf8')),
    'Canonical/manual/D1 transaction and chat/media baseline unchanged'
  )
  fs.unlinkSync(journalFile)
}
function tx(tag, identity, operation, hold) {
  return `begin;set local application_name=${q(
    tag
  )};set local lock_timeout='25s';${identity}
 do $$begin perform set_config('master.outcome','success',true);begin ${operation};exception when unique_violation or check_violation or insufficient_privilege then perform set_config('master.outcome',sqlstate,true);end;end;$$;
 ${
   hold ? 'select pg_sleep(12);' : ''
 }select current_setting('master.outcome') outcome,pg_backend_pid() pid,txid_current() xid;commit;`
}
async function race(first, second) {
  const tag = 'master_' + uuid().replaceAll('-', '')
  const a = query(tx(tag, first.identity, first.sql, true))
  a.catch(() => {})
  let held = false
  for (let i = 0; i < 12; i++) {
    const r = await query(
      `select wait_event from pg_stat_activity where application_name=${q(
        tag
      )};`
    )
    if (r[0]?.wait_event === 'PgSleep') {
      held = true
      break
    }
  }
  assert(held, 'Leader holds transaction after mutation')
  const b = query(tx(tag + '_b', second.identity, second.sql, false))
  b.catch(() => {})
  let overlap = false
  for (let i = 0; i < 8; i++) {
    const r = await query(
      `select wait_event_type,cardinality(pg_blocking_pids(pid)) blockers from pg_stat_activity where application_name=${q(
        tag + '_b'
      )};`
    )
    if (r[0]?.wait_event_type === 'Lock' && r[0].blockers > 0) {
      overlap = true
      break
    }
  }
  const results = (await Promise.all([a, b])).map((rows) =>
    rows.find((r) => 'outcome' in r)
  )
  assert(
    overlap,
    'Follower demonstrably waits on leader while both transactions overlap'
  )
  assert.notEqual(results[0].pid, results[1].pid)
  assert.notEqual(results[0].xid, results[1].xid)
  assert(!results.some((r) => ['40P01', '55P03'].includes(r.outcome)))
  return results.map((r) => r.outcome)
}
async function main() {
  if (process.argv[2] === 'recover') {
    scope = JSON.parse(fs.readFileSync(journalFile, 'utf8'))
    await cleanup()
    console.log('Exact synthetic journal recovery complete')
    return
  }
  assert(
    !fs.existsSync(journalFile),
    'Recover the exact previous journal before another synthetic run'
  )
  fs.writeFileSync(baselineFile, JSON.stringify(await fingerprint()))
  const people = [uuid(), uuid(), uuid()]
  const absent = await query(
    `begin read only;select count(*) n from auth.users where id in(${people
      .map(q)
      .join(',')});rollback;`
  )
  assert.equal(Number(absent[0].n), 0)
  const helper = fs
    .readFileSync('tests/delivery-area-economics-staging.sql', 'utf8')
    .split('do $$declare terms jsonb;')[0]
    .replace(
      'select gen_random_uuid() seller,gen_random_uuid() buyer,gen_random_uuid() outsider',
      `select ${q(people[0])}::uuid seller,${q(people[1])}::uuid buyer,${q(
        people[2]
      )}::uuid outsider`
    )
  const paidHelper = fs
    .readFileSync('tests/order-master-settlement-staging.sql', 'utf8')
    .split('do $$declare o public.orders;')[0]
  const seed = `begin;${helper}
 perform_placeholder
 ${paidHelper}
 create temp table master_results(id uuid,buyer uuid,seller uuid,mode text);
 do $$declare o public.orders;m text;i integer;begin
 perform public.marketplace_record_financial_capability((select seller from bc_people),'payout_account','ready','staging_test','master_race','payout','Test Bank','6789');
 perform public.marketplace_record_financial_capability((select buyer from bc_people),'payment_method','set','staging_test','master_race','method','Test Card','1234');
 foreach m in array array['on_campus','seller_delivery'] loop for i in 1..6 loop
 o:=pg_temp.master_order(m);if m='seller_delivery' then perform pg_temp.bc_actor(o.seller_id);perform public.marketplace_start_seller_delivery(o.id,gen_random_uuid());end if;
 insert into master_results values(o.id,o.buyer_id,o.seller_id,m);end loop;end loop;end;$$;
 set constraints all immediate;
 alter table public.listings enable trigger listings_publication_boundary;
 select jsonb_build_object('people',jsonb_build_array(seller,buyer,outsider),'orders',(select jsonb_agg(to_jsonb(r)) from master_results r)) scope from bc_people;commit;`.replace(
    'perform_placeholder',
    ''
  )
  // Prewrite the UUID marker journal; the transaction returns only synthetic identities.
  scope = { marker: 'master-race-' + uuid(), people, orders: [] }
  fs.writeFileSync(journalFile, JSON.stringify(scope))
  const rows = await query(seed)
  Object.assign(scope, rows.find((r) => r.scope)?.scope)
  fs.writeFileSync(journalFile, JSON.stringify(scope))
  const results = []
  try {
    for (const mode of ['on_campus', 'seller_delivery']) {
      const group = scope.orders.filter((o) => o.mode === mode)
      for (let i = 0; i < group.length; i++) {
        const o = group[i],
          own = await query(
            `begin read only;${actor(
              o.buyer
            )}select public.marketplace_handoff_credential(${q(
              o.id
            )})->>'code' code;rollback;`
          ),
          code = own[0].code
        const cancel = {
          identity: actor(o.buyer),
          sql: `perform public.marketplace_cancel_order(${q(
            o.id
          )},'buyer_changed_mind','Synthetic race',${q(uuid())})`,
        }
        const handoff = {
          identity: actor(o.seller),
          sql: `perform public.marketplace_verify_handoff(${q(o.id)},'code',${q(
            code
          )},${q(uuid())})`,
        }
        const outcomes = await race(
          ...(i % 2 === 0 ? [cancel, handoff] : [handoff, cancel])
        )
        const facts = (
          await query(`begin read only;select o.lifecycle_status life,o.holds_listing held,l.status listing,
     (select count(*) from public.transaction_events where order_id=o.id and event_type='order_cancelled') cancelled,
     (select count(*) from public.transaction_events where order_id=o.id and event_type='handoff_confirmed') handoff,
     (select count(*) from marketplace_private.order_protection where order_id=o.id) protection,
     (select count(*) from marketplace_private.order_settlement_authorizations where order_id=o.id) settlements
     from public.orders o join public.listings l on l.id=o.listing_id where o.id=${q(
       o.id
     )};rollback;`)
        )[0]
        if (i % 2 === 0) {
          assert.equal(facts.life, 'cancelled')
          assert.equal(facts.held, false)
          assert.equal(facts.listing, 'available')
          assert.equal(Number(facts.cancelled), 1)
          assert.equal(Number(facts.handoff), 0)
          assert.equal(Number(facts.protection), 0)
          assert.equal(Number(facts.settlements), 1)
        } else {
          assert.equal(facts.life, 'open')
          assert.equal(facts.held, true)
          assert.equal(facts.listing, 'pending')
          assert.equal(Number(facts.cancelled), 0)
          assert.equal(Number(facts.handoff), 1)
          assert.equal(Number(facts.protection), 1)
          assert.equal(Number(facts.settlements), 0)
        }
        results.push({
          mode,
          winner: i % 2 === 0 ? 'cancel' : 'handoff',
          outcomes,
          overlap: true,
        })
        console.log(JSON.stringify(results[results.length - 1]))
      }
    }
  } finally {
    await cleanup()
  }
  console.log(
    JSON.stringify({
      passed: true,
      runs: results.length,
      deadlocks: 0,
      lockTimeouts: 0,
      canonicalManualD1Unchanged: true,
      syntheticCleanup: true,
    })
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
