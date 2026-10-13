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
  root = path.resolve('tests/artifacts/offer-accept-c2-edge'),
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
const A = fs.readFileSync('public/demo/reading-chair.jpg'),
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
    for (let i = 0; i < 3; i++) {
      const token = crypto.randomUUID(),
        email = `c2edge_${token}@uwo.ca`,
        password = crypto.randomUUID() + 'aA1!'
      const u = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: 'C2e_' + token.replaceAll('-', '').slice(0, 12),
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
    for (const method of ['set', 'needs_attention']) {
      await capability(method, 1, 'payment_method')
      const f = await fixture(),
        cid = (
          await query(
            `select conversation_id from public.order_requests where id=${q(
              f.offer
            )};`
          )
        )[0].conversation_id
      const scheduled = new Date(
        Math.ceil((Date.now() + 6 * 3600000) / 900000) * 900000
      ).toISOString()
      const off = await clients[1].rpc('marketplace_create_offer', {
        p_conversation_id: cid,
        p_terms: {
          item_amount_cents: 7200,
          fulfillment: 'on_campus',
          meetup_location: 'Synthetic campus location',
          scheduled_at: scheduled,
          note: 'Inspect before payment',
        },
        p_client_action_id: crypto.randomUUID(),
      })
      assert(!off.error, off.error?.message)
      offers.push(off.data.id)
      f.offer = off.data.id
      journal()
      const cmd = crypto.randomUUID(),
        tracked = await rpc('marketplace_prepare_order_media', {
          p_offer: f.offer,
          p_actor: users[0],
          p_command: cmd,
        })
      batches.push(tracked.id)
      privatePaths.push(...tracked.assets.map((a) => a.path))
      journal()
      const b = await service.prepareOrderSnapshotMedia(
        clients[0],
        f.offer,
        cmd
      )
      assert(
        (
          await clients[0]
            .from('listings')
            .update({ status: 'pending' })
            .eq('id', f.lid)
        ).error,
        'No direct Pending'
      )
      assert(
        (
          await clients[1]
            .from('order_requests')
            .update({ status: 'accepted' })
            .eq('id', f.offer)
        ).error,
        'No direct Accepted'
      )
      assert(
        (await accept(f, b, crypto.randomUUID(), 1)).error,
        'Buyer sender cannot self-Accept'
      )
      const result = await accept(f, b, cmd, 0)
      assert(!result.error, result.error?.message)
      const o = result.data
      assert.equal(o.buyer_id, users[1])
      assert.equal(o.seller_id, users[0])
      assert.equal(o.terms_snapshot.senderId, users[1])
      assert.equal(o.terms_snapshot.recipientId, users[0])
      assert.equal(o.terms_snapshot.terms.fulfillment, 'on_campus')
      assert.equal(o.reservation_expires_at, null)
      assert(
        (
          await clients[0]
            .from('orders')
            .update({ order_protocol_version: 1 })
            .eq('id', o.id)
        ).error
      )
      assert(
        (
          await clients[0]
            .from('orders')
            .update({ listing_snapshot: { title: 'forged' } })
            .eq('id', o.id)
        ).error
      )
      assert(
        (
          await clients[0].rpc('marketplace_create_offer', {
            p_conversation_id: cid,
            p_terms: off.data.offer_terms,
            p_client_action_id: crypto.randomUUID(),
          })
        ).error,
        'No new Offer while Pending'
      )
      assert(
        (
          await clients[1].rpc('marketplace_create_offer', {
            p_conversation_id: cid,
            p_terms: off.data.offer_terms,
            p_client_action_id: crypto.randomUUID(),
          })
        ).error
      )
      const cancelCmd = crypto.randomUUID()
      const cancel = await clients[0].rpc('marketplace_cancel_order', {
        p_order_id: o.id,
        p_reason: 'seller_terms_issue',
        p_note: '',
        p_client_action_id: cancelCmd,
      })
      assert(!cancel.error)
      const replay = await clients[0].rpc('marketplace_cancel_order', {
        p_order_id: o.id,
        p_reason: 'seller_terms_issue',
        p_note: '',
        p_client_action_id: cancelCmd,
      })
      assert.equal(
        replay.data.order.cancelled_at,
        cancel.data.order.cancelled_at
      )
      const st = await facts(f)
      assert.equal(st.status, 'available')
      assert.equal(st.events.find((e) => e.type === 'order_cancelled').count, 1)
      assert.equal(
        (await service.signOrderSnapshotMedia(clients[1], o.id)).length,
        3
      )
      if (method === 'set') {
        const replacement = []
        for (let slot = 1; slot <= 3; slot++) {
          const id = crypto.randomUUID(),
            mediaPath = users[0] + '/' + f.lid + '/' + id
          publicPaths.push(mediaPath)
          replacement.push({ id, path: mediaPath, slot })
          journal()
          assert(
            !(
              await admin.storage.from('listing-images').upload(mediaPath, B, {
                contentType: 'image/png',
                upsert: false,
              })
            ).error
          )
        }
        await query(`begin;select id from public.listings where id=${q(
          f.lid
        )} for update;alter table public.listing_images disable trigger listing_images_publication_lock;
    delete from public.listing_images where listing_id=${q(
      f.lid
    )};insert into public.listing_images(id,listing_id,owner_id,slot,ready) values ${replacement
          .map((i) => `(${q(i.id)},${q(f.lid)},${q(users[0])},${i.slot},true)`)
          .join(',')};
    set constraints all immediate;alter table public.listing_images enable trigger listing_images_publication_lock;commit;`)
        assert(
          !(
            await clients[0].storage
              .from('listing-images')
              .remove(f.images.map((i) => i.path))
          ).error
        )
        assert(
          (await admin.storage.from('listing-images').info(f.images[0].path))
            .error
        )
        assert.equal(sha(await download(bucket, b.assets[0].path)), sha(A))
        assert.equal(
          sha(await download('listing-images', replacement[0].path)),
          sha(B)
        )
        passed(
          'real-V2-Order-terminal-A3-to-B3-public-source-cleanup-private-A-retained'
        )
      }
      passed(
        `Buyer-origin-Seller-Accept-On-Campus-payment-${method}-non-gate-role-integrity-Pending-denials-cancel-idempotency`
      )
    }
    await capability('set', 1, 'payment_method')
    const vf = await fixture(),
      vcid = (
        await query(
          `select conversation_id from public.order_requests where id=${q(
            vf.offer
          )};`
        )
      )[0].conversation_id
    assert(
      !(
        await clients[0].rpc('marketplace_withdraw_offer', {
          p_offer_id: vf.offer,
          p_client_action_id: crypto.randomUUID(),
          p_note: 'V1 regression setup',
        })
      ).error
    )
    const vr = await clients[0].rpc('marketplace_create_order_request', {
      p_conversation_id: vcid,
      p_terms: {
        item_amount_cents: 7000,
        fulfillment_type: 'shipping',
        shipping_cost_mode: 'included',
        shipping_amount_cents: 0,
        seller_note: 'V1 regression',
      },
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!vr.error, vr.error?.message)
    assert(
      (
        await clients[1].rpc('marketplace_offer_accept_preflight', {
          p_offer_id: vr.data.id,
          p_client_action_id: crypto.randomUUID(),
        })
      ).error,
      'V1 rejected by V2'
    )
    const va = await clients[1].rpc('marketplace_accept_order_request', {
      p_request_id: vr.data.id,
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!va.error, va.error?.message)
    orders.push(va.data.id)
    journal()
    assert.equal(va.data.order_protocol_version, 1)
    assert.equal(
      Date.parse(va.data.reservation_expires_at) -
        Date.parse(va.data.accepted_at),
      1800000
    )
    const vp = await admin.rpc('marketplace_simulate_order_payment_success', {
      p_order_id: va.data.id,
      p_buyer_id: users[1],
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!vp.error, vp.error?.message)
    assert.equal(vp.data.order.payment_status, 'paid')
    passed(
      'real-V1-Accept-30-minute-reservation-payment-simulator-preserved-and-V2-route-denial'
    )
  } catch (e) {
    failure = e
    console.log('Edge qualification failed: ' + e.message)
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
