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
  root = path.resolve('tests/artifacts/order-media-c1-tests'),
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
let marker = 'C1Media_' + crypto.randomUUID()
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
            `select '${t}' name,count(*) count,md5(coalesce(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text),'')) hash from ${t} t`
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
      description: 'Disposable C1 media qualification',
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
    const up = await clients[0].storage
      .from('listing-images')
      .upload(m.data.path, A, { contentType: 'image/jpeg', upsert: false })
    assert(!up.error)
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
  const off = await clients[1].rpc('marketplace_create_offer', {
    p_conversation_id: c.data.id,
    p_terms: {
      item_amount_cents: 7500,
      fulfillment: 'delivery',
      delivery_fee_cents: 0,
      delivery_method: 'courier',
      note: 'C1 isolated',
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
async function order(f) {
  const id = crypto.randomUUID()
  orders.push(id)
  journal()
  await query(`begin;lock table public.orders in access exclusive mode;alter table public.orders disable trigger orders_immutable;alter table public.orders disable trigger orders_event;
insert into public.orders(id,request_id,conversation_id,listing_id,listing_origin_id,buyer_id,seller_id,buyer_origin_id,seller_origin_id,terms_snapshot,item_amount_cents,shipping_amount_cents,service_fee_amount_cents,total_amount_cents,money_status,payment_status,lifecycle_status,holds_listing,created_at,updated_at,accepted_at)
select ${q(
    id
  )},r.id,r.conversation_id,r.listing_id,r.listing_origin_id,r.buyer_id,r.seller_id,r.buyer_origin_id,r.seller_origin_id,to_jsonb(r),r.item_amount_cents,null,null,null,'shipping_pending','pending','open',false,now(),now(),now() from public.order_requests r where r.id=${q(
    f.offer
  )} and r.protocol_version=2;
alter table public.orders enable trigger orders_immutable;alter table public.orders enable trigger orders_event;commit;`)
  return id
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
alter table public.transaction_events disable trigger transaction_events_immutable;alter table public.orders disable trigger orders_immutable;alter table public.order_requests disable trigger order_request_immutable;alter table public.listings disable trigger listings_publication_boundary;
delete from public.transaction_events where request_id in(select id from public.order_requests where listing_id in(${lids}));delete from marketplace_private.offer_commands where offer_id in(select id from public.order_requests where listing_id in(${lids}));delete from marketplace_private.order_commands where request_id in(select id from public.order_requests where listing_id in(${lids}));delete from public.orders where id in(${
    orders.length ? set(orders) : 'null'
  });delete from public.order_requests where listing_id in(${lids});delete from public.conversations where listing_id in(${lids});delete from public.listings where id in(${lids});
set constraints all immediate;alter table public.listings enable trigger listings_publication_boundary;alter table public.order_requests enable trigger order_request_immutable;alter table public.orders enable trigger orders_immutable;alter table public.transaction_events enable trigger transaction_events_immutable;commit;`)
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
const report = { project: ref, checks: [], deadlocks: 0, lockTimeouts: 0 }
const passed = (n) => {
  report.checks.push(n)
  console.log('PASS ' + n)
}
;(async () => {
  if (process.argv[2] === 'recover') {
    const scope = JSON.parse(
      fs.readFileSync(path.join(root, 'scope.json'), 'utf8')
    )
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
    const original = JSON.parse(
      fs.readFileSync('tests/artifacts/order-media-c1/baseline.json', 'utf8')
    )
    assert.deepEqual(await fingerprint(), original)
    console.log(
      'Scoped failure recovery complete; canonical/manual baseline restored exactly'
    )
    return
  }

  const home = await fetch('http://localhost:3000')
  const html = await home.text()
  assert.equal(home.status, 200)
  assert(html.includes(ref) && !html.includes('yzvchumzyonegujucyqs'))
  const before = await fingerprint()
  let failure
  try {
    for (let i = 0; i < 3; i++) {
      const token = crypto.randomUUID(),
        email = `c1media_${token}@uwo.ca`,
        password = crypto.randomUUID() + 'aA1!'
      const u = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: 'C1_' + token.replaceAll('-', '').slice(0, 12),
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

    if (process.argv[2] === 'supplement') {
      const f = await fixture(),
        cmd = crypto.randomUUID()
      const pending = await rpc('marketplace_prepare_order_media', {
        p_offer: f.offer,
        p_actor: users[1],
        p_command: cmd,
      })
      batches.push(pending.id)
      privatePaths.push(...pending.assets.map((a) => a.path))
      journal()
      const oid = await order(f)
      await query(
        `begin;do $$begin perform marketplace_private.bind_order_media(${q(
          pending.id
        )},${q(
          oid
        )});raise exception 'Incomplete bound';exception when check_violation then null;end$$;rollback;`
      )
      assert.equal((await state(pending)).state, 'preparing')
      await expire(pending)
      assert.equal(await service.cleanupOrderSnapshotMedia(pending.id), true)
      assert(
        (
          await clients[2].rpc('marketplace_verify_order_media', {
            p_asset: pending.assets[0].id,
            p_mime: 'image/jpeg',
            p_size: A.length,
            p_sha: sha(A),
          })
        ).error
      )
      assert(
        (
          await clients[2].rpc('marketplace_claim_order_media_cleanup', {
            p_batch: pending.id,
          })
        ).error
      )
      assert(
        (
          await clients[2].rpc('marketplace_order_snapshot_media', {
            p_order: oid,
          })
        ).error
      )
      const forged = await admin.rpc('marketplace_prepare_order_media', {
        p_offer: f.offer,
        p_actor: users[2],
        p_command: crypto.randomUUID(),
      })
      assert(forged.error)
      passed(
        'incomplete-bind-denied-stale-preparing-cleanup-source-context-forgery'
      )
      report.concurrentRuns = 0
      for (const winner of ['bind', 'edit']) {
        const x = await fixture(),
          b = await prepare(x),
          o = await order(x),
          tag = 'c1edit_' + crypto.randomUUID().replaceAll('-', '')
        const mutate = `update public.listings set description='Changed material state' where id=${q(
          x.lid
        )};`
        const bind = `select marketplace_private.bind_order_media(${q(
          b.id
        )},${q(o)});`
        const a = query(
          `begin;set local application_name=${q(
            tag
          )};set local lock_timeout='10s';${
            winner === 'bind' ? bind : mutate
          }select pg_sleep(40);commit;`
        )
        let seen = false
        for (let n = 0; n < 6; n++) {
          const r = await query(
            `select wait_event from pg_stat_activity where application_name=${q(
              tag
            )};`
          )
          if (r[0]?.wait_event === 'PgSleep') {
            seen = true
            break
          }
        }
        assert(seen)
        const tagB = tag + '_b'
        const second =
          winner === 'bind'
            ? mutate
            : `do $$begin perform marketplace_private.bind_order_media(${q(
                b.id
              )},${q(
                o
              )});raise exception 'Stale binding accepted';exception when check_violation then null;end$$;`
        const other = query(
          `begin;set local application_name=${q(
            tagB
          )};set local lock_timeout='55s';${second}commit;`
        )
        let overlap = false
        for (let n = 0; n < 6; n++) {
          const r = await query(
            `select wait_event_type,cardinality(pg_blocking_pids(pid)) blockers from pg_stat_activity where application_name=${q(
              tagB
            )};`
          )
          if (r[0]?.wait_event_type === 'Lock' && r[0].blockers > 0) {
            overlap = true
            break
          }
        }
        assert(overlap, 'Listing race must overlap and block')
        await Promise.all([a, other])
        report.concurrentRuns++
        assert.equal(
          (await state(b)).state,
          winner === 'bind' ? 'bound' : 'prepared'
        )
        if (winner === 'bind') {
          const sellerMedia = await service.signOrderSnapshotMedia(
            clients[0],
            o
          )
          assert.equal(sellerMedia.length, 3)
          assert.equal(
            sha(
              Buffer.from(
                await (await fetch(sellerMedia[0].previewUrl)).arrayBuffer()
              )
            ),
            sha(A)
          )
          await clients[0].storage
            .from(bucket)
            .remove(b.assets.map((a) => a.path))
          assert.equal(sha(await download(bucket, b.assets[0].path)), sha(A))
          passed('Seller-signed-access-and-protected-direct-delete-denial')

          const replacement = []
          for (let slot = 1; slot <= 3; slot++) {
            const id = crypto.randomUUID(),
              path = users[0] + '/' + x.lid + '/' + id
            publicPaths.push(path)
            replacement.push({ id, path, slot })
            journal()
            assert(
              !(
                await admin.storage
                  .from('listing-images')
                  .upload(path, B, { contentType: 'image/png', upsert: false })
              ).error
            )
          }
          await query(
            `begin;select id from public.listings where id=${q(
              x.lid
            )} for update;alter table public.listing_images disable trigger listing_images_publication_lock;delete from public.listing_images where listing_id=${q(
              x.lid
            )};insert into public.listing_images(id,listing_id,owner_id,slot,ready) values ${replacement
              .map(
                (i) => `(${q(i.id)},${q(x.lid)},${q(users[0])},${i.slot},true)`
              )
              .join(
                ','
              )};set constraints all immediate;alter table public.listing_images enable trigger listing_images_publication_lock;commit;`
          )
          assert(
            !(
              await clients[0].storage
                .from('listing-images')
                .remove(x.images.map((i) => i.path))
            ).error
          )
          assert(
            (await admin.storage.from('listing-images').info(x.images[0].path))
              .error
          )
          assert.equal(sha(await download(bucket, b.assets[0].path)), sha(A))
          assert.equal(
            sha(await download('listing-images', replacement[0].path)),
            sha(B)
          )
          passed(
            'atomic-complete-live-A3-to-B3-gallery-public-source-independent'
          )
        } else {
          await expire(b)
          assert.equal(await service.cleanupOrderSnapshotMedia(b.id), true)
        }
        passed('true-Listing-edit-concurrency-' + winner + '-wins')
      }
      return
    }
    const f = await fixture()
    const original = sha(await download('listing-images', f.images[0].path))
    const overwrite = await clients[0].storage
      .from('listing-images')
      .upload(f.images[0].path, B, { contentType: 'image/png', upsert: true })
    assert(overwrite.error)
    assert.equal(
      sha(await download('listing-images', f.images[0].path)),
      original
    )
    passed('public-source-no-overwrite')
    const command = crypto.randomUUID()
    const b = await prepare(f, command)
    assert.equal(b.state, 'prepared')
    assert.equal(b.assets.length, 3)
    assert.deepEqual(
      b.assets.map((a) => a.position),
      [1, 2, 3]
    )
    for (const a of b.assets) {
      assert.equal(a.sha256, sha(A))
      assert.equal(sha(await download(bucket, a.path)), sha(A))
    }
    assert.equal((await prepare(f, command)).id, b.id)
    passed('private-copy-SHA-multi-image-idempotency')
    assert(
      (
        await clients[2].rpc('marketplace_prepare_order_media', {
          p_offer: f.offer,
          p_actor: users[2],
          p_command: crypto.randomUUID(),
        })
      ).error
    )
    assert(
      (
        await clients[2].storage
          .from(bucket)
          .createSignedUrl(b.assets[0].path, 60)
      ).error
    )
    assert(
      (
        await clients[0].storage.from(bucket).upload(b.assets[0].path, B, {
          upsert: true,
          contentType: 'image/png',
        })
      ).error
    )
    assert(
      (await clients[2].storage.from(bucket).download(b.assets[0].path)).error
    )
    const pub = await fetch(
      env.NEXT_PUBLIC_SUPABASE_URL +
        '/storage/v1/object/public/' +
        bucket +
        '/' +
        b.assets[0].path
    )
    assert(!pub.ok)
    passed('private-bucket-outsider-client-write-denial')
    const oid = await order(f)
    await query(
      `begin;select marketplace_private.bind_order_media(${q(b.id)},${q(
        oid
      )});commit;`
    )
    assert.equal((await state(b)).state, 'bound')
    assert.equal(await service.cleanupOrderSnapshotMedia(b.id), false)
    assert(
      (
        await clients[2].rpc('marketplace_order_snapshot_media', {
          p_order: oid,
        })
      ).error
    )
    const signed = await service.signOrderSnapshotMedia(clients[1], oid)
    assert.equal(signed.length, 3)
    assert.equal(
      sha(Buffer.from(await (await fetch(signed[0].previewUrl)).arrayBuffer())),
      sha(A)
    )
    passed('bound-retention-authorized-signing')
    // Published editing remains prohibited in normal UI. Test administration changes
    // only the marked synthetic media under the same Listing lock.
    const newId = crypto.randomUUID()
    let newPath
    await query(
      `begin;select id from public.listings where id=${q(
        f.lid
      )} for update;alter table public.listing_images disable trigger listing_images_publication_lock;delete from public.listing_images where listing_id=${q(
        f.lid
      )};insert into public.listing_images(id,listing_id,owner_id,slot,ready) values(${q(
        newId
      )},${q(f.lid)},${q(
        users[0]
      )},1,false);alter table public.listing_images enable trigger listing_images_publication_lock;commit;`
    )
    newPath = users[0] + '/' + f.lid + '/' + newId
    publicPaths.push(newPath)
    journal()
    assert(
      !(
        await admin.storage
          .from('listing-images')
          .upload(newPath, B, { contentType: 'image/png', upsert: false })
      ).error
    )
    await query(
      `begin;select id from public.listings where id=${q(
        f.lid
      )} for update;alter table public.listing_images disable trigger listing_images_publication_lock;update public.listing_images set ready=true where id=${q(
        newId
      )};alter table public.listing_images enable trigger listing_images_publication_lock;commit;`
    )
    assert(
      !(
        await clients[0].storage
          .from('listing-images')
          .remove(f.images.map((i) => i.path))
      ).error
    )
    const gone = await admin.storage
      .from('listing-images')
      .info(f.images[0].path)
    assert(gone.error)
    assert.equal(sha(await download(bucket, b.assets[0].path)), sha(A))
    assert.equal(sha(await download('listing-images', newPath)), sha(B))
    passed('live-A-to-B-public-A-cleanup-private-A-retained')
    await query(
      `begin;alter table public.orders disable trigger orders_immutable;update public.orders set lifecycle_status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=buyer_id,cancelled_by_role='buyer',cancel_reason_code='buyer_changed_mind',cancel_reason_label_snapshot='Changed my mind',cancel_note='' where id=${q(
        oid
      )};alter table public.orders enable trigger orders_immutable;commit;`
    )
    assert.equal(await service.cleanupOrderSnapshotMedia(b.id), false)
    assert.equal(sha(await download(bucket, b.assets[0].path)), sha(A))
    passed('terminal-order-retention')
    const g = await fixture()
    const cmd = crypto.randomUUID()
    let partial = await rpc('marketplace_prepare_order_media', {
      p_offer: g.offer,
      p_actor: users[1],
      p_command: cmd,
    })
    batches.push(partial.id)
    privatePaths.push(...partial.assets.map((a) => a.path))
    journal()
    const normalFetch = global.fetch
    let injected = false
    global.fetch = async (input, options) => {
      if (
        !injected &&
        String(input).includes(
          '/storage/v1/object/' + bucket + '/' + partial.assets[1].path
        ) &&
        options?.method === 'POST'
      ) {
        injected = true
        return new Response(
          JSON.stringify({
            message: 'Injected upload failure',
            statusCode: 503,
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return normalFetch(input, options)
    }
    try {
      await assert.rejects(
        service.prepareOrderSnapshotMedia(clients[1], g.offer, cmd)
      )
    } finally {
      global.fetch = normalFetch
    }
    assert(injected)
    assert.equal((await state(partial)).state, 'preparing')
    const recovered = await prepare(g, cmd)
    assert.equal(recovered.id, partial.id)
    assert.equal(recovered.state, 'prepared')
    passed('partial-copy-failure-retry-known-assets')
    const staleOrder = await order(g)
    await query(
      `update public.listings set description='Material state changed' where id=${q(
        g.lid
      )};`
    )
    const rejection = await query(
      `begin;do $$begin perform marketplace_private.bind_order_media(${q(
        recovered.id
      )},${q(
        staleOrder
      )});raise exception 'Stale binding accepted';exception when check_violation then null;end$$;select state from marketplace_private.order_media_batches where id=${q(
        recovered.id
      )};rollback;`
    )
    assert.equal(rejection[0].state, 'prepared')
    passed('stale-material-bind-rejection')
    await expire(recovered)
    let lease = await rpc('marketplace_claim_order_media_cleanup', {
      p_batch: recovered.id,
    })
    assert(lease)
    await query(
      `update marketplace_private.order_media_batches set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(
        recovered.id
      )};`
    )
    assert.equal(await service.cleanupOrderSnapshotMedia(recovered.id), true)
    assert.equal((await state(recovered)).state, 'deleted')
    passed('crashed-lease-recovery-unbound-cleanup')
    const h = await fixture(),
      d = await prepare(h)
    await expire(d)
    let deleteFailure = false
    global.fetch = async (input, options) => {
      if (
        String(input).includes('/storage/v1/object/' + bucket) &&
        options?.method === 'DELETE'
      ) {
        deleteFailure = true
        return new Response(
          JSON.stringify({
            message: 'Injected delete failure',
            statusCode: 503,
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } }
        )
      }
      return normalFetch(input, options)
    }
    try {
      await assert.rejects(service.cleanupOrderSnapshotMedia(d.id))
    } finally {
      global.fetch = normalFetch
    }
    assert(deleteFailure)
    assert.equal((await state(d)).state, 'delete_claimed')
    await query(
      `update marketplace_private.order_media_batches set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(
        d.id
      )};`
    )
    assert.equal(await service.cleanupOrderSnapshotMedia(d.id), true)
    passed('Storage-delete-failure-recovery')
    // Tombstone tracks a delayed upload after deletion. Reconciliation removes it.
    assert(
      !(
        await admin.storage.from(bucket).upload(d.assets[0].path, A, {
          contentType: 'image/jpeg',
          upsert: false,
        })
      ).error
    )
    assert.equal(await service.cleanupOrderSnapshotMedia(d.id), true)
    assert((await admin.storage.from(bucket).download(d.assets[0].path)).error)
    passed('late-upload-tombstone-reconciliation')
    report.concurrentRuns = 0
    for (const winner of ['bind', 'cleanup']) {
      const x = await fixture(),
        asset = await prepare(x),
        o = await order(x)
      const tag = 'c1_' + crypto.randomUUID().replaceAll('-', '')
      if (winner === 'bind')
        await query(
          `update marketplace_private.order_media_batches set expires_at=clock_timestamp()+interval '60 seconds' where id=${q(
            asset.id
          )};`
        )
      else await expire(asset)
      const first =
        winner === 'bind'
          ? `select marketplace_private.bind_order_media(${q(asset.id)},${q(
              o
            )});`
          : `select public.marketplace_claim_order_media_cleanup(${q(
              asset.id
            )});`
      const a = query(
        `begin;set local application_name=${q(
          tag
        )};set local lock_timeout='10s';${first}select pg_sleep(40);commit;`
      )
      let observed = false
      for (let n = 0; n < 6; n++) {
        const row = await query(
          `select wait_event from pg_stat_activity where application_name=${q(
            tag
          )};`
        )
        if (row[0]?.wait_event === 'PgSleep') {
          observed = true
          break
        }
      }
      assert(observed, 'Transaction A must hold its lock')
      const second =
        winner === 'bind'
          ? `select public.marketplace_claim_order_media_cleanup(${q(
              asset.id
            )});`
          : `do $$begin perform marketplace_private.bind_order_media(${q(
              asset.id
            )},${q(
              o
            )});raise exception 'Delete-claimed asset bound';exception when check_violation then null;end$$;`
      const tagB = tag + '_b'
      const transactionB = query(
        `begin;set local application_name=${q(
          tagB
        )};set local lock_timeout='55s';${second}commit;`
      )
      let blocked = false
      for (let n = 0; n < 6; n++) {
        const row = await query(
          `select wait_event_type,cardinality(pg_blocking_pids(pid)) blockers from pg_stat_activity where application_name=${q(
            tagB
          )};`
        )
        if (row[0]?.wait_event_type === 'Lock' && row[0].blockers > 0) {
          blocked = true
          break
        }
      }
      assert(blocked, 'Independent Transaction B must overlap and block')
      await Promise.all([a, transactionB])
      const end = await state(asset)
      assert.equal(end.state, winner === 'bind' ? 'bound' : 'delete_claimed')
      if (winner === 'cleanup') {
        await query(
          `update marketplace_private.order_media_batches set lease_expires_at=clock_timestamp()-interval '1 second' where id=${q(
            asset.id
          )};`
        )
        assert.equal(await service.cleanupOrderSnapshotMedia(asset.id), true)
      } else
        assert.equal(sha(await download(bucket, asset.assets[0].path)), sha(A))
      report.concurrentRuns++
      passed('true-concurrency-' + winner + '-wins')
    }
  } catch (e) {
    failure = e
    fs.writeFileSync(
      path.join(root, 'failure.json'),
      JSON.stringify({ message: e.message })
    )
    console.log(
      'Qualification failed: ' + e.message + '; performing scoped cleanup'
    )
  } finally {
    await cleanup()
    assert.deepEqual(await fingerprint(), before)
    report.syntheticCleanup = true
    report.manualFingerprintUnchanged = true
    fs.writeFileSync(
      path.join(
        root,
        process.argv[2] === 'supplement'
          ? 'supplement-report.json'
          : 'report.json'
      ),
      JSON.stringify(report, null, 2)
    )
  }
  if (failure) throw failure
  console.log(JSON.stringify(report))
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
