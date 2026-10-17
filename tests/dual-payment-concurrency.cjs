// Disposable staging fixtures only; exact scope journal and ownership-checked cleanup.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const { Worker } = require('node:worker_threads')
const h = require('../scripts/v2-maintenance-staging.cjs')
const journal = path.resolve('tests/artifacts/dual-payment-race-scope.json')
assert(
  process.argv.includes('--recover') || !fs.existsSync(journal),
  'Recover exact previous journal before starting another run'
)
const scope = process.argv.includes('--recover')
  ? JSON.parse(fs.readFileSync(journal, 'utf8'))
  : []
const tables = [
  'public.listings',
  'public.orders',
  'public.order_requests',
  'public.conversations',
  'public.messages',
  'public.transaction_events',
  'public.listing_favorites',
  'auth.users',
  'public.profiles',
  'storage.objects',
  'marketplace_private.financial_capabilities',
]
const fingerprint = () =>
  h.query(
    'begin read only;' +
      tables
        .map(
          (t) =>
            `select '${t}' name,count(*) n,md5(coalesce(string_agg(to_jsonb(x)::text,'' order by to_jsonb(x)::text),'')) hash from ${t} x`
        )
        .join(' union all ') +
      ';rollback;'
  )
const before = fingerprint()
const actor = (id) =>
  `select set_config('request.jwt.claims',${h.q(
    JSON.stringify({ sub: id, role: 'authenticated' })
  )},true);`
const pending = []
const asyncQuery = (sql) => {
  const work = new Promise((resolve, reject) => {
    const worker = new Worker(
      `const {parentPort,workerData}=require('node:worker_threads');try{parentPort.postMessage({rows:require(workerData.helper).query(workerData.sql)})}catch(e){parentPort.postMessage({error:e.message})}`,
      {
        eval: true,
        workerData: {
          helper: path.resolve('scripts/v2-maintenance-staging.cjs'),
          sql,
        },
      }
    )
    worker.once('message', (m) =>
      m.error ? reject(Error(m.error)) : resolve(m.rows)
    )
    worker.once('error', reject)
  })
  pending.push(work)
  return work
}
async function fixture(seedSeller = false) {
  const env = h.environment(),
    { createClient } = require('@supabase/supabase-js')
  const admin = createClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } }
  )
  const passwords = {},
    created = []
  const provisional = { users: created }
  scope.push(provisional)
  for (let i = 0; i < 3; i++) {
    const marker = crypto.randomUUID(),
      password = crypto.randomBytes(32).toString('base64url') + 'Aa9!'
    provisional.pendingEmail = 'dualrace_' + marker + '@uwo.ca'
    provisional.pendingUsername =
      'DR_' + marker.replaceAll('-', '').slice(0, 12)
    fs.writeFileSync(journal, JSON.stringify(scope))
    const result = await admin.auth.admin.createUser({
      email: 'dualrace_' + marker + '@uwo.ca',
      password,
      email_confirm: true,
      user_metadata: {
        username: 'DR_' + marker.replaceAll('-', '').slice(0, 12),
      },
    })
    assert(
      !result.error,
      'Synthetic Auth creation ' +
        (result.error?.code || result.error?.status || '')
    )
    created.push(result.data.user.id)
    delete provisional.pendingEmail
    delete provisional.pendingUsername
    passwords[result.data.user.id] = password
    fs.writeFileSync(journal, JSON.stringify(scope))
  }
  const [seller, buyer, outsider] = created
  const prefix = fs
    .readFileSync('tests/dual-payment-staging.sql', 'utf8')
    .split('do $$declare terms jsonb;')[0]
    .replace(
      /create temporary table bc_people[\s\S]*?create function pg_temp.bc_actor/,
      `create temporary table bc_people as select '${seller}'::uuid seller,'${buyer}'::uuid buyer,'${outsider}'::uuid outsider;\ncreate function pg_temp.bc_actor`
    )

  const marker = crypto.randomUUID()
  const sql = `begin;${prefix}
 create temporary table race_order as select o.* from pg_temp.bc_accept(jsonb_build_object('item_amount_cents',10000,'fulfillment','on_campus','meetup_location','Synthetic race ${marker}','scheduled_at',date_trunc('hour',clock_timestamp())+interval '3 hours','payment_mode','external','payment_mode_version',1)) o;
 select pg_temp.dual_agree(id) from race_order;
 ${
   seedSeller
     ? `select pg_temp.bc_actor(seller) from bc_people;select public.marketplace_confirm_external_exchange(id,gen_random_uuid()) from race_order;`
     : ''
 }
 set constraints all immediate;alter table public.listings enable trigger listings_publication_boundary;
 select o.id oid,o.listing_id lid,p.buyer,p.seller,p.outsider from race_order o cross join bc_people p;commit;`
  const f = h.query(sql).find((r) => r.oid)
  assert(f)
  Object.assign(provisional, f)
  fs.writeFileSync(journal, JSON.stringify(scope))
  return { ...f, passwords }
}
function operation(f, kind, tag, sleep = 0) {
  const who = kind === 'seller' ? f.seller : f.buyer
  const statement =
    kind === 'cancel'
      ? `public.marketplace_cancel_order('${f.oid}','buyer_changed_mind','',gen_random_uuid())`
      : kind === 'dispute'
      ? `public.marketplace_dispute_external_exchange('${f.oid}','Exchange did not occur',gen_random_uuid())`
      : `public.marketplace_confirm_external_exchange('${f.oid}',gen_random_uuid())`
  return `begin;set local application_name='${tag}';set local lock_timeout='60s';${actor(
    who
  )}
 create temporary table outcome(value jsonb,sqlstate text);
 do $$begin begin insert into outcome(value) select ${statement};exception when others then insert into outcome(sqlstate)values(sqlstate);end;end;$$;
 do $$begin perform pg_sleep(${sleep});exception when query_canceled then null;end;$$;select * from outcome;commit;`
}
async function observe(tag, wait, blocker) {
  for (let i = 0; i < 15; i++) {
    const row = h
      .query(
        `select pid,wait_event_type,wait_event,pg_blocking_pids(pid) blockers from pg_stat_activity where ${
          blocker
            ? `${Number(blocker)}=any(pg_blocking_pids(pid))`
            : `application_name='${tag}'`
        }`
      )
      .find((r) =>
        wait === 'sleep'
          ? r.wait_event === 'PgSleep'
          : r.wait_event_type === 'Lock'
      )
    if (row) return row
    await new Promise((r) => setTimeout(r, 100))
  }
  throw Error('Actual race overlap not observed: ' + wait)
}
async function cleanup() {
  for (const f of scope) {
    if (f.pendingEmail) {
      assert(
        /^dualrace_[0-9a-f-]{36}@uwo[.]ca$/.test(f.pendingEmail),
        'Exact synthetic pending identity'
      )
      for (const row of h.query(
        `select id from auth.users where email=${h.q(
          f.pendingEmail
        )} and raw_user_meta_data->>'username'=${h.q(f.pendingUsername)}`
      ))
        if (!f.users.includes(row.id)) f.users.push(row.id)
      fs.writeFileSync(journal, JSON.stringify(scope))
    }
    if (!f.oid) {
      if (f.users?.length)
        h.query(
          `begin;delete from auth.users where id in(${h.ids(
            f.users
          )}) and email like 'dualrace_%@uwo.ca';commit;`
        )
      continue
    }
    const users = h.ids([f.buyer, f.seller, f.outsider]),
      oid = h.q(f.oid),
      lid = h.q(f.lid)
    const privateTables = [
      'external_exchanges',
      'order_agreements',
      'order_flow_commands',
      'notification_reminders',
      'buyer_receipt_commands',
      'courier_commands',
      'courier_shipments',
      'protection_cases',
      'order_protection',
      'handoff_authorizations',
      'delivery_checkouts',
      'v2_order_economics',
      'campus_payment_attempts',
      'campus_inspections',
      'meetup_commands',
      'meetup_expiries',
      'order_snapshot_media',
    ]
    const guarded = [
      'public.listings',
      'public.orders',
      'public.order_requests',
      'public.transaction_events',
      'public.order_meetup_revisions',
      'public.messages',
      ...privateTables.map((t) => 'marketplace_private.' + t),
      'marketplace_private.order_media_assets',
      'marketplace_private.order_media_batches',
      'marketplace_private.order_media_commands',
    ]
    const media = h.query(
      `select a.path from marketplace_private.order_media_assets a join marketplace_private.order_media_batches b on b.id=a.batch_id where b.listing_id=${lid} and b.buyer_id='${f.buyer}' and b.seller_id='${f.seller}'`
    )
    if (media.length) {
      const env = h.environment()
      const admin = require('@supabase/supabase-js').createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false } }
      )
      const result = await admin.storage
        .from('order-snapshot-media')
        .remove(media.map((r) => r.path))
      assert(!result.error, 'Exact synthetic Storage API cleanup')
    }
    h.query(`begin;set local lock_timeout='15s';
   lock table public.listings,public.orders,public.order_requests,public.conversations in access exclusive mode;
   do $$begin if not exists(select 1 from public.orders where id=${oid} and listing_id=${lid} and buyer_id='${
      f.buyer
    }' and seller_id='${
      f.seller
    }' and terms_snapshot#>>'{terms,payment_mode}'='external')
   or not exists(select 1 from public.listings where id=${lid} and seller_id='${
      f.seller
    }' and title='Dual payment rollback fixture')
   or exists(select 1 from public.orders where listing_id=${lid} and id<>${oid})
   or exists(select 1 from public.conversations where listing_id<>${lid} and (buyer_id in(${users}) or seller_id in(${users}))) then raise exception 'Synthetic ownership mismatch';end if;end;$$;
   create temporary table restore_triggers as select c.oid::regclass tab,t.tgname from pg_trigger t join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and t.tgenabled='O' and c.oid in(${guarded
     .map((t) => h.q(t) + '::regclass')
     .join(',')});
   do $$declare r record;begin for r in select * from restore_triggers loop execute format('alter table %s disable trigger %I',r.tab,r.tgname);end loop;end;$$;
   delete from marketplace_private.notification_deliveries where notification_identity in(select id from public.notifications where recipient_user_id in(${users}));
   delete from public.notifications where recipient_user_id in(${users});
   delete from marketplace_private.notification_events where destination->>'orderId'=${h.q(
     f.oid
   )} or destination->>'conversationId' in(select id::text from public.conversations where listing_id=${lid});
   ${privateTables
     .map((t) => `delete from marketplace_private.${t} where order_id=${oid};`)
     .join('\n')}
   delete from public.order_meetup_revisions where order_id=${oid};
   delete from marketplace_private.order_media_commands where batch_id in(select id from marketplace_private.order_media_batches where listing_id=${lid});
   delete from marketplace_private.order_media_assets where batch_id in(select id from marketplace_private.order_media_batches where listing_id=${lid});
   delete from marketplace_private.order_media_batches where listing_id=${lid};
   delete from marketplace_private.offer_accept_commands where order_id=${oid};
   delete from marketplace_private.order_commands where order_id=${oid};
   delete from marketplace_private.offer_commands where offer_id in(select id from public.order_requests where listing_id=${lid});
   delete from public.transaction_events where order_id=${oid} or request_id in(select id from public.order_requests where listing_id=${lid});
   update public.listings set status='available',reserved_order_id=null where id=${lid};
   delete from public.orders where id=${oid};delete from public.order_requests where listing_id=${lid};
   delete from public.messages where conversation_id in(select id from public.conversations where listing_id=${lid});
   delete from public.conversations where listing_id=${lid};delete from public.listings where id=${lid};
   delete from auth.users where id in(${users});
   set constraints all immediate;
   do $$declare r record;begin for r in select * from restore_triggers loop execute format('alter table %s enable trigger %I',r.tab,r.tgname);end loop;end;$$;
   commit;select true cleaned;`)
  }
}
async function run() {
  if (process.argv.includes('--recover')) {
    await cleanup()
    fs.unlinkSync(journal)
    console.log('PASS exact journal-scoped recovery')
    return
  }
  fs.writeFileSync(journal + '.baseline', JSON.stringify(before))
  try {
    for (const [first, second, expected] of [
      ['buyer', 'seller', 'completed'],
      ['buyer', 'cancel', 'open'],
      ['cancel', 'buyer', 'cancelled'],
      ['dispute', 'buyer', 'open'],
    ]) {
      console.log('START synthetic race ' + first + ' vs ' + second)
      const f = await fixture(first === 'dispute'),
        tag = 'external_' + crypto.randomUUID().replaceAll('-', '')
      const env = h.environment(),
        { createClient } = require('@supabase/supabase-js')
      const admin = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      const secondUser = second === 'seller' ? f.seller : f.buyer
      const password = f.passwords[secondUser]

      const client = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      const signed = await client.auth.signInWithPassword({
        email: (await admin.auth.admin.getUserById(secondUser)).data.user.email,
        password,
      })
      assert(!signed.error, 'Synthetic participant login')
      const warm = await client.rpc('marketplace_order_fulfillment', {
        p_order_id: f.oid,
      })
      assert(!warm.error, 'Warm participant RPC')
      const a = asyncQuery(operation(f, first, tag + 'a', 50))
      a.catch(() => {})
      const holder = await observe(tag + 'a', 'sleep')
      console.log('Observed uncommitted holder')
      const name =
        second === 'cancel'
          ? 'marketplace_cancel_order'
          : second === 'dispute'
          ? 'marketplace_dispute_external_exchange'
          : 'marketplace_confirm_external_exchange'
      const params = {
        p_order_id: f.oid,
        p_client_action_id: crypto.randomUUID(),
        ...(second === 'cancel'
          ? { p_reason: 'buyer_changed_mind', p_note: '' }
          : second === 'dispute'
          ? { p_reason: 'Exchange did not occur' }
          : {}),
      }
      const b = client
        .rpc(name, params)
        .then((result) => [
          { value: result.data, sqlstate: result.error?.code ?? null },
        ])
      pending.push(b)
      b.catch(() => {})
      const waiter = await observe(tag + 'b', 'lock', holder.pid)
      console.log('Observed blocked contender')
      assert(
        h
          .query(
            `select pg_cancel_backend(pid) released from pg_stat_activity where pid=${holder.pid} and application_name='${tag}a' and wait_event='PgSleep'`
          )
          .some((r) => r.released),
        'Release only the synthetic sleep barrier'
      )
      assert(
        waiter.blockers.includes(holder.pid),
        'Actual independent sessions must overlap on domain lock'
      )
      const results = (await Promise.all([a, b]))
        .flat()
        .filter((r) => 'sqlstate' in r)
      assert.equal(results[0].sqlstate, null)
      if (first === 'buyer' && second === 'seller')
        assert.equal(results[1].sqlstate, null)
      else if (second === 'cancel') {
        assert.equal(results[1].sqlstate, null)
        assert.equal(results[1].value.errorCode, 'order_not_cancellable')
      } else
        assert.equal(
          results[1].sqlstate,
          '23505',
          'Contradictory confirmation must be rejected by state authority'
        )

      assert(
        !results.some((r) => ['40P01', '55P03', '57014'].includes(r.sqlstate)),
        'No deadlock or timeout: ' + results.map((r) => r.sqlstate).join(',')
      )
      const state = h.query(
        `select lifecycle_status,payment_status,payout_status,holds_listing,(select status from public.listings where id=o.listing_id) inventory,(select count(*) from marketplace_private.order_settlement_authorizations where order_id=o.id) settlements,(select count(*) from marketplace_private.order_protection where order_id=o.id) protections from public.orders o where id='${f.oid}'`
      )
      assert.equal(state[0].lifecycle_status, expected)
      assert.equal(state[0].payment_status, 'pending')
      assert.equal(state[0].payout_status, 'not_eligible')
      assert.equal(state[0].holds_listing, expected === 'open')
      assert.equal(
        state[0].inventory,
        expected === 'open'
          ? 'pending'
          : expected === 'completed'
          ? 'sold'
          : 'available'
      )
      assert.equal(state[0].settlements, 0)
      assert.equal(state[0].protections, 0)

      console.log(
        'PASS actual overlap ' + first + ' vs ' + second + ' -> ' + expected
      )
    }
  } catch (error) {
    console.log('Race qualification failed: ' + error.message)
    throw error
  } finally {
    await Promise.allSettled(pending)
    await cleanup()
    assert.deepEqual(fingerprint(), before, 'Canonical/manual graph unchanged')
    fs.unlinkSync(journal)
    console.log('PASS synthetic race cleanup and unchanged fingerprints')
  }
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
