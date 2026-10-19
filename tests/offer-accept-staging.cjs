const { readTestPictureJpeg } = require('../scripts/lib/test-pictures.cjs')
/* global fetch */
// Isolated real hosted staging C1 qualification. No canonical accounts/transactions.
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict'),
  crypto = require('crypto'),
  Module = require('module'),
  ts = require('typescript')
const { spawn, spawnSync } = require('child_process')
const { createClient } = require('@supabase/supabase-js')
const ref = 'pcaqxezdfxofysghssyo',
  root = path.resolve('tests/artifacts/offer-accept-c2-tests'),
  bucket = 'order-snapshot-media'
const env = Object.fromEntries(
  fs
    .readFileSync('.env.staging.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      let i = l.indexOf('=')
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
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
Object.assign(process.env, env)
fs.mkdirSync(root, { recursive: true })
const claims = JSON.parse(
  Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url')
)
assert.equal(claims.ref, ref)
assert.equal(claims.role, 'service_role')
const resolve = Module._resolveFilename
Module._resolveFilename = function (id, ...args) {
  return resolve.call(
    this,
    id.startsWith('@/') ? path.resolve(id.slice(2)) : id,
    ...args
  )
}
require.extensions['.ts'] = (m, f) =>
  m._compile(
    ts.transpileModule(fs.readFileSync(f, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
      },
    }).outputText,
    f
  )
const service = require('../lib/server/order-snapshot-media.ts')
const admin = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
const clients = [],
  users = [],
  listings = [],
  offers = [],
  batches = [],
  orders = [],
  publicPaths = [],
  privatePaths = []
let marker = 'C2Accept_' + crypto.randomUUID()
let seq = 0
const q = (v) => "'" + String(v).replaceAll("'", "''") + "'",
  set = (v) => v.map(q).join(',')
function journal() {
  fs.writeFileSync(
    path.join(root, 'scope.json'),
    JSON.stringify({
      marker,
      users,
      listings,
      offers,
      batches,
      orders,
      publicPaths,
      privatePaths,
    })
  )
}
async function query(sql) {
  const f = path.join(root, `operation-${++seq}.sql`)
  fs.writeFileSync(f, sql)
  return new Promise((ok, no) => {
    const p = spawn(
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
    let o = '',
      e = ''
    p.stdout.on('data', (b) => (o += b))
    p.stderr.on('data', (b) => (e += b))
    p.on('error', no)
    p.on('close', (code) => {
      fs.unlinkSync(f)
      if (code) {
        fs.writeFileSync(f + '.diagnostic', e || o)
        return no(Error('Staging SQL failed; diagnostic remains ignored'))
      }
      try {
        ok(JSON.parse(o.slice(o.indexOf('{'))).rows)
      } catch (err) {
        no(err)
      }
    })
  })
}
const tables = [
  'public.order_requests',
  'public.orders',
  'public.transaction_events',
  'public.listings',
  'public.listing_images',
  'marketplace_private.offer_commands',
  'marketplace_private.order_commands',
  'marketplace_private.financial_capabilities',
]
const fingerprint = () =>
  query(
    'begin read only;' +
      tables
        .map(
          (t) =>
            `select '${t}' name,count(*) count,md5(coalesce(string_agg((to_jsonb(t)-array['order_protocol_version','listing_snapshot','listing_material_hash_at_offer'])::text,'' order by (to_jsonb(t)-array['order_protocol_version','listing_snapshot','listing_material_hash_at_offer'])::text),'')) hash from ${t} t`
        )
        .join(' union all ') +
      ';rollback;'
  )
async function rpc(name, args) {
  const r = await admin.rpc(name, args)
  if (r.error) {
    fs.writeFileSync(
      path.join(root, 'rpc-diagnostic.json'),
      JSON.stringify({ code: r.error.code, message: r.error.message })
    )
    throw Error('Trusted media RPC rejected; see ignored diagnostic')
  }
  return r.data
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')
const A = readTestPictureJpeg('chair'),
  B = fs.readFileSync('public/static/icons/icon-maskable-512x512.png')
async function download(b, p, client = admin) {
  const r = await client.storage.from(b).download(p)
  assert(!r.error && r.data, 'Object must remain readable by authority')
  return Buffer.from(await r.data.arrayBuffer())
}
async function fixture() {
  for (const client of clients) {
    const refreshed = await client.auth.refreshSession()
    assert(!refreshed.error, 'Synthetic session refresh failed')
  }
  const template = (
    await query(
      'select currency,category,subcategory,condition,pickup_area from public.listings where published_at is not null limit 1;'
    )
  )[0]
  const r = await clients[0]
    .from('listings')
    .insert({
      ...template,
      title: marker,
      description: 'Disposable C2 Accept qualification',
      price_cents: 8000,
      expected_image_count: 3,
    })
    .select('id')
    .single()
  assert(!r.error && r.data, 'Synthetic Listing insert')
  const lid = r.data.id
  listings.push(lid)
  journal()
  const images = []
  for (let slot = 1; slot <= 3; slot++) {
    const m = await clients[0]
      .from('listing_images')
      .insert({ listing_id: lid, slot })
      .select('id,path,slot')
      .single()
    assert(!m.error)
    images.push(m.data)
    publicPaths.push(m.data.path)
    journal()
    let up
    for(let attempt=0;attempt<3;attempt++) {
      up=await clients[0].storage.from('listing-images').upload(m.data.path,A,{contentType:'image/jpeg',upsert:false})
      if(!up.error) break
      if(!/fetch failed|Failed to fetch/.test(up.error.message || '')) break
      // Transport-only fixture retry: reconcile exact immutable key if upload reached Storage.
      const existing=await admin.storage.from('listing-images').info(m.data.path)
      if(!existing.error){assert.equal(sha(await download('listing-images',m.data.path)),sha(A));up={error:null};break}
      await new Promise(resolve=>setTimeout(resolve,300))
    }
    assert(!up.error,'Synthetic public upload failed: '+(up.error?.statusCode || '')+' '+(up.error?.message || ''))
    assert(
      !(
        await clients[0]
          .from('listing_images')
          .update({ ready: true })
          .eq('id', m.data.id)
      ).error
    )
  }
  assert(
    !(await clients[0].rpc('marketplace_finalize_listing', { listing_id: lid }))
      .error
  )
  const c = await clients[1].rpc('marketplace_find_or_create_conversation', {
    p_listing_id: lid,
  })
  assert(!c.error)
  const off = await clients[0].rpc('marketplace_create_offer', {
    p_conversation_id: c.data.id,
    p_terms: {
      item_amount_cents: 7500,
      fulfillment: 'delivery',
      delivery_fee_cents: 0,
      delivery_method: 'courier',
      note: 'C2 isolated',
    },
    p_client_action_id: crypto.randomUUID(),
  })
  assert(!off.error)
  offers.push(off.data.id)
  journal()
  return { lid, offer: off.data.id, images }
}
async function prepare(f, command = crypto.randomUUID()) {
  const tracked = await rpc('marketplace_prepare_order_media', {
    p_offer: f.offer,
    p_actor: users[1],
    p_command: command,
  })
  if (!batches.includes(tracked.id)) {
    batches.push(tracked.id)
    privatePaths.push(...tracked.assets.map((a) => a.path))
    journal()
  }
  const b = await service.prepareOrderSnapshotMedia(
    clients[1],
    f.offer,
    command
  )
  if (!batches.includes(b.id)) {
    batches.push(b.id)
    privatePaths.push(...b.assets.map((a) => a.path))
    journal()
  }
  return b
}
async function expire(b) {
  await query(
    `update marketplace_private.order_media_batches set expires_at=clock_timestamp()-interval '1 second' where id=${q(
      b.id
    )} and order_id is null;`
  )
}
async function state(b) {
  return (
    await query(
      `select state,order_id from marketplace_private.order_media_batches where id=${q(
        b.id
      )};`
    )
  )[0]
}
async function cleanup() {
  if (listings.length) {
    const actualOrders = await query(
      `select id from public.orders where listing_id in(${set(listings)});`
    )
    for (const row of actualOrders)
      if (!orders.includes(row.id)) orders.push(row.id)
  }
  journal()
  const bids = batches.length ? set(batches) : 'null'
  const lids = listings.length ? set(listings) : 'null'
  // Exact synthetic graph only. No Storage metadata DML and no canonical reset.
  await query(`begin;lock table public.orders,public.order_requests,public.listings,public.transaction_events in access exclusive mode;
do $$begin if exists(select 1 from public.listings where id in(${lids}) and (title<>${q(
    marker
  )} or seller_id<>${q(
    users[0] || '00000000-0000-0000-0000-000000000000'
  )})) then raise exception 'Fixture scope mismatch';end if;end$$;
delete from marketplace_private.order_snapshot_media where order_id in(${
    orders.length ? set(orders) : 'null'
  });
delete from marketplace_private.order_media_commands where batch_id in(${bids});delete from marketplace_private.order_media_assets where batch_id in(${bids});delete from marketplace_private.order_media_batches where id in(${bids});
alter table public.transaction_events disable trigger transaction_events_immutable;alter table public.orders disable trigger orders_immutable;alter table public.order_requests disable trigger order_request_immutable;alter table public.listings disable trigger listings_publication_boundary;alter table public.listings disable trigger listings_inventory_guard;
update public.listings set status='available',reserved_order_id=null where id in(${lids});delete from marketplace_private.offer_accept_commands where offer_id in(select id from public.order_requests where listing_id in(${lids}));delete from public.transaction_events where request_id in(select id from public.order_requests where listing_id in(${lids}));delete from marketplace_private.offer_commands where offer_id in(select id from public.order_requests where listing_id in(${lids}));delete from marketplace_private.order_commands where request_id in(select id from public.order_requests where listing_id in(${lids}));delete from public.orders where id in(${
    orders.length ? set(orders) : 'null'
  });delete from public.order_requests where listing_id in(${lids});delete from public.conversations where listing_id in(${lids});delete from public.listings where id in(${lids});
set constraints all immediate;alter table public.listings enable trigger listings_inventory_guard;alter table public.listings enable trigger listings_publication_boundary;alter table public.order_requests enable trigger order_request_immutable;alter table public.orders enable trigger orders_immutable;alter table public.transaction_events enable trigger transaction_events_immutable;commit;`)
  for (const [b, paths] of [
    ['listing-images', publicPaths],
    [bucket, privatePaths],
  ])
    if (paths.length)
      assert(
        !(await admin.storage.from(b).remove(paths)).error,
        'Scoped Storage cleanup'
      )
  for (const u of users)
    assert(
      !(await admin.auth.admin.deleteUser(u)).error,
      'Synthetic Auth cleanup'
    )
  const left = await query(
    `select count(*) count from storage.objects where (bucket_id='listing-images' and name in(${
      publicPaths.length ? set(publicPaths) : 'null'
    })) or(bucket_id=${q(bucket)} and name in(${
      privatePaths.length ? set(privatePaths) : 'null'
    }));`
  )
  assert.equal(left[0].count, 0)
}
const report = {
  project: ref,
  checks: [],
  concurrentRuns: 0,
  deadlocks: 0,
  lockTimeouts: 0,
}
const passed = (name) => {
  report.checks.push(name)
  console.log('PASS ' + name)
}
async function capability(
  status = 'ready',
  index = 0,
  kind = 'payout_account'
) {
  const r = await admin.rpc('marketplace_record_financial_capability', {
    p_user_id: users[index],
    p_capability: kind,
    p_status: status,
    p_provider_key: 'staging_simulator',
    p_provider_owner_ref: marker,
    p_provider_instrument_ref: marker,
    p_display_label: 'Synthetic account',
    p_last4: '4242',
  })
  assert(!r.error, 'Scoped capability setup')
}
async function accept(f, b, command = crypto.randomUUID(), who = 1) {
  const r = await clients[who].rpc('marketplace_accept_offer', {
    p_offer_id: f.offer,
    p_client_action_id: command,
    p_media_batch: b.id,
  })
  if (!r.error) {
    if (!orders.includes(r.data.id)) orders.push(r.data.id)
    journal()
  }
  return r
}
async function facts(f) {
  return (
    await query(`select l.status,l.reserved_order_id,(select count(*) from public.orders where listing_id=l.id) order_count,
 (select count(*) from public.orders where listing_id=l.id and holds_listing) hold_count,
 (select jsonb_agg(to_jsonb(o)) from public.orders o where listing_id=l.id) orders,
 (select jsonb_agg(jsonb_build_object('id',r.id,'status',r.status)) from public.order_requests r where listing_id=l.id) offers,
 (select jsonb_agg(jsonb_build_object('type',e.event_type,'count',e.n)) from (select event_type,count(*) n from public.transaction_events where request_id in(select id from public.order_requests where listing_id=l.id) group by event_type) e) events
 from public.listings l where l.id=${q(f.lid)};`)
  )[0]
}
;(async () => {
  if (process.argv[2] === 'recover') {
    const scope = JSON.parse(
      fs.readFileSync(path.join(root, 'scope.json'), 'utf8')
    )
    assert(scope.marker.startsWith('C2Accept_'), 'Recovery scope marker')
    marker = scope.marker
    for (const [name, target] of Object.entries({
      users,
      listings,
      offers,
      batches,
      orders,
      publicPaths,
      privatePaths,
    }))
      target.push(...scope[name])
    await cleanup()
    const baseline = JSON.parse(
      fs.readFileSync('tests/artifacts/offer-accept-c2/baseline.json', 'utf8')
    )
    assert.deepEqual(await fingerprint(), baseline)
    console.log(
      'Scoped C2 recovery complete; canonical/manual baseline unchanged'
    )
    return
  }
  const before = await fingerprint()
  let failure
  try {
    for (let i = 0; i < 4; i++) {
      const token = crypto.randomUUID(),
        email = `c2accept_${token}@uwo.ca`,
        password = crypto.randomUUID() + 'aA1!'
      const u = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: 'C2_' + token.replaceAll('-', '').slice(0, 12),
        },
      })
      assert(!u.error)
      users.push(u.data.user.id)
      journal()
      const c = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false, autoRefreshToken: false } }
      )
      assert(!(await c.auth.signInWithPassword({ email, password })).error)
      clients.push(c)
    }
    await capability()
    const f = await fixture(),
      b = await prepare(f),
      cmd = crypto.randomUUID()
    assert((await accept(f, b, crypto.randomUUID(), 0)).error, 'Sender denied')
    assert(
      (await accept(f, b, crypto.randomUUID(), 3)).error,
      'Outsider denied'
    )
    const v1 = await clients[1].rpc('marketplace_accept_order_request', {
      p_request_id: f.offer,
      p_client_action_id: crypto.randomUUID(),
    })
    assert(v1.error, 'V2 cannot enter V1 Accept')
    await capability('needs_attention')
    assert(
      (await accept(f, b)).error,
      'Payout downgrade blocks final authority'
    )
    await capability()
    const a = await accept(f, b, cmd)
    assert(!a.error, a.error?.message)
    const o = a.data
    assert.equal(o.order_protocol_version, 2)
    assert.equal(o.buyer_id, users[1])
    assert.equal(o.seller_id, users[0])
    assert.equal(o.payment_status, 'pending')
    assert.equal(o.reservation_expires_at, null)
    assert.equal(o.lifecycle_status, 'open')
    assert.equal((await facts(f)).status, 'pending')
    assert.equal((await state(b)).state, 'bound')
    assert(!(await clients[1].rpc('marketplace_financial_capabilities')).error)
    const buyerCaps = await clients[1].rpc('marketplace_financial_capabilities')
    assert.equal(buyerCaps.data.paymentMethod.status, 'unset')
    await capability('needs_attention')
    const replay = await accept(f, b, cmd)
    assert(!replay.error)
    assert.equal(replay.data.id, o.id)
    assert.equal(replay.data.accepted_at, o.accepted_at)
    const retry = await clients[1].rpc('marketplace_offer_accept_preflight', {
      p_offer_id: f.offer,
      p_client_action_id: cmd,
    })
    assert.equal(retry.data.orderId, o.id)
    await capability()
    assert.equal((await facts(f)).order_count, 1)
    const simulation = await admin.rpc(
      'marketplace_simulate_order_payment_success',
      {
        p_order_id: o.id,
        p_buyer_id: users[1],
        p_client_action_id: crypto.randomUUID(),
      }
    )
    assert(simulation.error)
    passed(
      'recipient-only-roles-payout-lock-payment-Unset-non-gate-idempotency-no-V1-timer-simulator'
    )
    const signed = await service.signOrderSnapshotMedia(clients[1], o.id)
    assert.equal(signed.length, 3)
    assert.equal(
      sha(Buffer.from(await (await fetch(signed[0].previewUrl)).arrayBuffer())),
      sha(A)
    )
    assert.equal(
      (await service.signOrderSnapshotMedia(clients[0], o.id)).length,
      3
    )
    await assert.rejects(service.signOrderSnapshotMedia(clients[3], o.id))
    assert(
      !(
        await clients[0]
          .from('listings')
          .update({ description: 'Updated live B' })
          .eq('id', f.lid)
      ).error
    )
    const detail = await clients[1].rpc('marketplace_order_detail', {
      p_order_id: o.id,
    })
    assert(!detail.error)
    assert.equal(
      detail.data.order.listing_snapshot.description,
      'Disposable C2 Accept qualification'
    )
    const cancel = await clients[1].rpc('marketplace_cancel_order', {
      p_order_id: o.id,
      p_reason: 'buyer_changed_mind',
      p_note: '',
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!cancel.error, cancel.error?.message)
    assert.equal(cancel.data.order.lifecycle_status, 'cancelled')
    assert.equal((await facts(f)).status, 'available')
    assert.equal((await facts(f)).offers[0].status, 'accepted')
    assert.equal(
      (await service.signOrderSnapshotMedia(clients[1], o.id)).length,
      3
    )
    passed(
      'private-participant-read-live-edit-independent-snapshot-prepayment-cancel-release-terminal-retention'
    )
    for (const kind of ['material', 'lower', 'higher', 'unknown']) {
      const x = await fixture(),
        media = await prepare(x)
      if (kind === 'material')
        assert(
          !(
            await clients[0]
              .from('listings')
              .update({ description: 'Material edit' })
              .eq('id', x.lid)
          ).error
        )
      if (kind === 'lower')
        assert(
          !(
            await clients[0]
              .from('listings')
              .update({ price_cents: 7000 })
              .eq('id', x.lid)
          ).error
        )
      if (kind === 'higher')
        assert(
          !(
            await clients[0]
              .from('listings')
              .update({ price_cents: 9000 })
              .eq('id', x.lid)
          ).error
        )
      if (kind === 'unknown')
        await query(
          `begin;lock table public.order_requests in access exclusive mode;alter table public.order_requests disable trigger order_request_immutable;update public.order_requests set listing_material_hash_at_offer=null where id=${q(
            x.offer
          )};alter table public.order_requests enable trigger order_request_immutable;commit;`
        )
      const result = await accept(x, media)
      if (kind === 'higher') {
        assert(!result.error, result.error?.message)
        assert.equal(result.data.listing_snapshot.askingPriceCents, 9000)
        assert.equal(result.data.item_amount_cents, 7500)
      } else {
        assert(result.error)
        const st = await facts(x)
        assert.equal(st.status, 'available')
        assert.equal(st.order_count, 0)
        assert.equal(st.offers[0].status, 'active')
        assert.equal((await state(media)).state, 'prepared')
      }
    }
    passed('material-change-lower-price-higher-price-pre-C-unknown-baseline')
  } catch (e) {
    failure = e
    console.log('C2 qualification failure: ' + e.message)
  } finally {
    await cleanup()
    assert.deepEqual(await fingerprint(), before)
    report.syntheticCleanup = true
    report.manualFingerprintUnchanged = true
    fs.writeFileSync(
      path.join(root, 'report.json'),
      JSON.stringify(report, null, 2)
    )
  }
  if (failure) throw failure
  console.log(JSON.stringify(report))
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
