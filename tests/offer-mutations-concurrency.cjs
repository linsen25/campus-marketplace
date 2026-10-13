/* global fetch */
// Real independent staging transactions; no canonical fixture or application changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/offer-mutations-concurrency')
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
const users = []
let seller, buyer
const accounts = []
const realtimeClients = []
const received = [[], [], []]
const { createClient } = require('@supabase/supabase-js')
let marker = 'A2 concurrency ' + crypto.randomUUID()
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
  'marketplace_private.offer_commands',
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
      delete from marketplace_private.offer_commands where offer_id in(select id from public.order_requests where listing_id in(${set}));
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
  )},'A2 synthetic concurrency',8000,currency,category,subcategory,condition,pickup_area,1,clock_timestamp() from public.listings where published_at is not null limit 1;
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
function operation(
  who,
  f,
  tag,
  delay,
  kind = 'offer',
  key = crypto.randomUUID()
) {
  const call = kind.startsWith('capability')
    ? `perform public.marketplace_record_financial_capability('${seller}','payout_account','${
        kind === 'capability-ready' ? 'ready' : 'needs_attention'
      }','staging_test','a2_race','race_payout','Test Bank','6789');insert into outcome values(null,null);`
    : `insert into outcome select id,null from public.marketplace_create_offer('${f.cid}','{"item_amount_cents":7000,"note":"concurrent"}','${key}');`
  return `begin;set local application_name='${tag}';set local lock_timeout='60s';set local statement_timeout='90s';create temporary table outcome(id uuid,sqlstate text);grant all on outcome to authenticated;
 ${
   kind === 'offer-blocked'
     ? `select marketplace_private.lock_financial_capability('${seller}','payout_account');`
     : ''
 }
 ${kind.startsWith('capability') ? '' : actor(who)}
 do $test$ begin ${call} exception when others then insert into outcome values(null,sqlstate);end;$test$;
 reset role;${
   delay ? `select pg_sleep(${delay});` : ''
 }select *,pg_backend_pid() pid,txid_current() xid from outcome;commit;`
}
async function race(mode, round) {
  await query(
    `select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test','a2_race','race_payout','Test Bank','6789');`
  )
  const f = await fixture()
  await query(
    `begin;${actor(buyer)}select public.marketplace_create_offer('${
      f.cid
    }','{"item_amount_cents":8000}',gen_random_uuid());commit;`
  )
  if (mode.startsWith('payout-ready'))
    await query(
      `select public.marketplace_record_financial_capability('${seller}','payout_account','needs_attention','staging_test','a2_race','race_payout','Test Bank','6789');`
    )
  const tag = 'a2race_' + crypto.randomUUID().replaceAll('-', '')
  const firstWho =
    mode === 'buyer-buyer' || mode === 'buyer-seller' ? buyer : seller
  const secondWho =
    mode === 'seller-seller' ||
    mode === 'buyer-seller' ||
    mode.startsWith('payout') ||
    mode === 'duplicate'
      ? seller
      : buyer
  const key = crypto.randomUUID()
  const first = query(
    operation(
      firstWho,
      f,
      tag + '_a',
      mode.startsWith('payout') ? 30 : 12,
      mode === 'payout-first'
        ? 'capability'
        : mode === 'payout-ready-first'
        ? 'capability-ready'
        : mode === 'payout-ready-last'
        ? 'offer-blocked'
        : 'offer',
      key
    )
  )
  const held = await observe(tag + '_a', 'sleep')
  const second = query(
    operation(
      secondWho,
      f,
      tag + '_b',
      0,
      mode === 'payout-last'
        ? 'capability'
        : mode === 'payout-ready-last'
        ? 'capability-ready'
        : 'offer',
      mode === 'duplicate' ? key : crypto.randomUUID()
    )
  )
  const wait = await observe(tag + '_b', 'lock')
  assert.notEqual(held.pid, wait.pid)
  assert.notEqual(held.xid, wait.xid)
  assert(wait.blockers.includes(held.pid))
  const [a, b] = await Promise.all([first, second])
  for (const r of [a[0], b[0]]) {
    if (r.sqlstate === '40P01') report.deadlocks++
    if (r.sqlstate === '55P03') report.lockTimeouts++
    if (r.sqlstate === '57014') report.statementTimeouts++
  }
  assert.equal(a[0].sqlstate, mode === 'payout-ready-last' ? 'P0001' : null)
  assert.equal(b[0].sqlstate, mode === 'payout-first' ? 'P0001' : null)
  if (mode === 'duplicate') assert.equal(a[0].id, b[0].id)
  const state = (
    await query(`select (select count(*) from public.order_requests where conversation_id='${f.cid}' and protocol_version=2 and status='active') active,
 (select count(*) from public.order_requests where conversation_id='${f.cid}' and protocol_version=2) offers,
 (select count(*) from public.orders where conversation_id='${f.cid}') orders,
 (select count(*) from public.transaction_events where conversation_id='${f.cid}' and event_type like 'offer_%') events,
 (select count(*) from marketplace_private.offer_commands where offer_id in(select id from public.order_requests where conversation_id='${f.cid}')) commands,
 (select sender_user_id from public.order_requests where conversation_id='${f.cid}' and protocol_version=2 and status='active') sender,
 status inventory from public.listings where id='${f.lid}';`)
  )[0]
  const count =
    mode === 'payout-first' || mode === 'payout-ready-last'
      ? 1
      : mode === 'payout-last' ||
        mode === 'duplicate' ||
        mode === 'payout-ready-first'
      ? 2
      : 3
  assert.equal(state.active, 1)
  assert.equal(state.offers, count)
  assert.equal(state.events, 1 + 2 * (count - 1))
  assert.equal(state.commands, count)
  assert.equal(state.orders, 0)
  assert.equal(state.inventory, 'available')
  assert.equal(
    state.sender,
    mode === 'payout-first' || mode === 'payout-ready-last'
      ? buyer
      : mode === 'payout-last' ||
        mode === 'duplicate' ||
        mode === 'payout-ready-first'
      ? firstWho
      : secondWho
  )
  report.results.push({ mode, round, state, holder: held, waiter: wait })
  console.log(
    `PASS ${mode} round ${round}: distinct transactions with observed blocker; one Active, immutable rows/events, no Order/inventory change`
  )
}
async function apiSmoke() {
  const base = 'http://localhost:3000'
  const html = await (await fetch(base + '/home')).text()
  let bound = false
  for (const m of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const js = (await (await fetch(new URL(m[1], base))).text()).replaceAll(
      String.fromCharCode(92, 34),
      '"'
    )
    bound ||=
      /(?:var|let|const)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo/.test(js)
  }
  assert(bound, 'Main app must be staging')
  const cookies = []
  for (const account of accounts.slice(0, 2)) {
    const response = await fetch(base + '/api/auth/sign-in', {
      method: 'POST',
      headers: {
        Origin: base,
        'Content-Type': 'application/json',
        'X-Marketplace-Request': '1',
      },
      body: JSON.stringify(account),
    })
    assert.equal(response.status, 200)
    cookies.push(
      response.headers
        .getSetCookie()
        .map((c) => c.split(';')[0])
        .join('; ')
    )
  }
  async function api(index, url, body) {
    const response = await fetch(base + url, {
      method: body ? 'POST' : 'GET',
      headers: {
        Cookie: cookies[index],
        Origin: base,
        'Content-Type': 'application/json',
        'X-Marketplace-Request': '1',
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    return { status: response.status, data: await response.json() }
  }
  await query(
    `select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test','a2_race','race_payout','Test Bank','6789');`
  )
  const f = await fixture()
  await query(
    `select public.marketplace_record_financial_capability('${seller}','payout_account','unset',null,null,null,null,null);`
  )
  const buyerOffer = await api(1, '/api/offers', {
    conversationId: f.cid,
    terms: { item_amount_cents: 7100 },
    clientActionId: crypto.randomUUID(),
  })
  assert.equal(buyerOffer.status, 200)
  assert.equal(buyerOffer.data.senderId, buyer)
  assert.equal(buyerOffer.data.canWithdraw, true)
  const denied = await api(0, '/api/offers', {
    conversationId: f.cid,
    terms: { item_amount_cents: 7200 },
    clientActionId: crypto.randomUUID(),
  })
  assert.equal(denied.status, 409)
  assert.equal(denied.data.code, 'seller_payout_not_ready')
  await query(
    `select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test','a2_race','race_payout','Test Bank','6789');`
  )
  const sellerOffer = await api(0, '/api/offers', {
    conversationId: f.cid,
    terms: { item_amount_cents: 7200 },
    clientActionId: crypto.randomUUID(),
  })
  assert.equal(sellerOffer.status, 200)
  assert.equal(sellerOffer.data.senderId, seller)
  const history = await api(1, '/api/offers?conversationId=' + f.cid)
  assert.equal(history.status, 200)
  assert.equal(history.data.offers.length, 2)
  assert.equal(history.data.offers[0].status, 'Replaced')
  assert.equal(history.data.offers[1].canWithdraw, false)
  assert.equal(
    (
      await api(1, '/api/offers/' + sellerOffer.data.id + '/withdraw', {
        clientActionId: crypto.randomUUID(),
      })
    ).status,
    403
  )
  assert.equal(
    (
      await api(1, '/api/offers/' + sellerOffer.data.id + '/accept', {
        clientActionId: crypto.randomUUID(),
      })
    ).status,
    404
  )
  const key = crypto.randomUUID(),
    path = '/api/offers/' + sellerOffer.data.id + '/withdraw'
  assert.equal(
    (await api(0, path, { clientActionId: key, note: 'API smoke' })).data
      .status,
    'Withdrawn'
  )
  assert.equal(
    (await api(0, path, { clientActionId: key, note: 'API smoke' })).data
      .status,
    'Withdrawn'
  )
  report.apiSmoke = {
    buyerCreate: 200,
    sellerGate: 409,
    sellerCounter: 200,
    history: 200,
    recipientWithdraw: 403,
    acceptUnsupported: 404,
    senderWithdraw: 200,
    idempotentWithdraw: 200,
  }
  console.log('PASS real localhost:3000 staging Offer API synthetic flow')
}
async function main() {
  if (process.argv[2] === 'cleanup') {
    const scope = JSON.parse(
      fs.readFileSync(path.join(root, 'scope.json'), 'utf8')
    )
    users.push(...scope.users)
    listings.push(...scope.listings)
    marker = scope.marker
    seller = users[0]
    buyer = users[1]
    await cleanup()
    console.log('Recovered exact journal-owned fixtures only')
    return
  }
  journal()
  const before = await fingerprint()
  try {
    const admin = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    assert(env.SUPABASE_SERVICE_ROLE_KEY)
    const claims = JSON.parse(
      Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url')
    )
    assert.equal(claims.ref, ref)
    assert.equal(claims.role, 'service_role')
    for (let index = 0; index < 3; index++) {
      const token = crypto.randomUUID(),
        email = `a2race_${token}@uwo.ca`,
        password = crypto.randomUUID() + 'aA1!'
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: 'A2Race_' + token.replaceAll('-', '').slice(0, 12),
        },
      })
      assert(!error && data.user, 'Synthetic user creation failed')
      users.push(data.user.id)
      accounts.push({ email, password })
      journal()
      const client = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      realtimeClients.push(client)
      const signed = await client.auth.signInWithPassword({ email, password })
      assert(!signed.error, 'Synthetic session failed')
      await client.realtime.setAuth(signed.data.session.access_token)
      await new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(Error('Private join timeout')),
          15000
        )
        client
          .channel('marketplace:messages:' + data.user.id, {
            config: { private: true },
          })
          .on('broadcast', { event: 'messages_changed' }, (event) => {
            const payload = event.payload
            if (
              Object.keys(payload).some(
                (key) =>
                  !['conversationId', 'role', 'scope', 'id'].includes(key)
              ) ||
              !['history', 'list'].includes(payload.scope)
            )
              report.realtimeInvalid = true
            received[index].push(payload)
          })
          .subscribe((status) => {
            if (status === 'SUBSCRIBED') {
              clearTimeout(timer)
              resolve()
            } else if (['CHANNEL_ERROR', 'TIMED_OUT'].includes(status)) {
              clearTimeout(timer)
              reject(Error('Private join rejected'))
            }
          })
      })
    }
    seller = users[0]
    buyer = users[1]
    await apiSmoke()
    if (['finish', 'realtime'].includes(process.argv[2])) {
      const previous = JSON.parse(
        fs.readFileSync(path.join(root, 'results.json'), 'utf8')
      )
      assert(
        previous.cleanup &&
          previous.results.length === (process.argv[2] === 'realtime' ? 13 : 8)
      )
      report.results.push(...previous.results)
    } else
      for (let round = 1; round <= 2; round++)
        for (const mode of [
          'buyer-seller',
          'seller-buyer',
          'buyer-buyer',
          'seller-seller',
        ])
          await race(mode, round)
    if (process.argv[2] !== 'realtime')
      for (const mode of [
        'payout-first',
        'payout-last',
        'payout-ready-first',
        'payout-ready-last',
        'duplicate',
      ])
        await race(mode, 1)
    assert(!report.realtimeInvalid, 'Realtime payload safe')
    assert(
      received[0].length > 0 && received[1].length > 0,
      'Both participants receive invalidation'
    )
    assert.equal(
      received[2].length,
      0,
      'Unrelated user receives no Offer invalidation'
    )
    assert(received[0].every((x) => x.role === 'selling'))
    assert(received[1].every((x) => x.role === 'buying'))
    report.realtime = {
      sellerSignals: received[0].length,
      buyerSignals: received[1].length,
      outsiderSignals: 0,
      privateJoins: 3,
      payloadSafe: true,
    }
  } finally {
    for (const client of realtimeClients) {
      await client.removeAllChannels()
      client.realtime.disconnect()
    }
    await cleanup()
    assert.deepEqual(
      await fingerprint(),
      before,
      'Canonical graph exact after cleanup'
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
      invariantFailures: report.invariantFailures,
      cleanup: report.cleanup,
      realtime: report.realtime,
    })
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
