const { readTestPictureJpeg } = require('../scripts/lib/test-pictures.cjs')
/* global fetch */
// Isolated real hosted staging D1 qualification using C1 private media. No canonical accounts/transactions.
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict'),
  crypto = require('crypto'),
  Module = require('module'),
  ts = require('typescript')
const { spawn, spawnSync } = require('child_process')
const { createClient } = require('@supabase/supabase-js')
const { parseRows } = require('../scripts/cli-json-result.cjs')
const ref = 'pcaqxezdfxofysghssyo',
  root = path.resolve('tests/artifacts/meetup-d1-fixtures'),
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
global.fetch = require('./staging-media-transport.cjs').createStagingMediaFetch(
  global.fetch,
  undefined,
  (diagnostic) =>
    fs.appendFileSync(
      path.join(root, 'private-upload-diagnostic.jsonl'),
      JSON.stringify(diagnostic) + '\n'
    )
)
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
let marker = 'D1Meetup_' + crypto.randomUUID()
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
    const fail = (message, code = null) => {
      fs.writeFileSync(
        f + '.diagnostic',
        JSON.stringify({
          message,
          code,
          stdoutLength: o.length,
          stderrLength: e.length,
        })
      )
      no(Error(message + '; diagnostic remains ignored'))
    }
    p.on('error', () => fail('Staging SQL process launch failed'))
    p.on('close', (code) => {
      fs.unlinkSync(f)
      if (code !== 0) return fail('Staging SQL process failed', code)
      try {
        ok(parseRows(o))
      } catch (err) {
        fail(err.message, code)
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
  'marketplace_private.order_media_batches',
  'marketplace_private.order_media_commands',
  'marketplace_private.order_media_assets',
  'marketplace_private.order_snapshot_media',
  'public.notifications',
  'marketplace_private.notification_events',
  'marketplace_private.notification_reminders',
  'marketplace_private.v2_order_economics',
  'marketplace_private.delivery_checkouts',
  'marketplace_private.handoff_authorizations',
  'marketplace_private.order_protection',
  'marketplace_private.protection_cases',
  'marketplace_private.courier_shipments',
  'marketplace_private.courier_commands',
  'marketplace_private.buyer_receipt_commands',
]
const fingerprint = () =>
  query(
    'begin read only;' +
      tables
        .map(
          (t) =>
            `select '${t}' name,count(*) count,md5(coalesce(string_agg((to_jsonb(t))::text,'' order by (to_jsonb(t))::text),'')) hash from ${t} t`
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
async function fixture(mode = 'on_campus', createOffer = true) {
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
    for (let attempt = 0; attempt < 3; attempt++) {
      up = await clients[0].storage
        .from('listing-images')
        .upload(m.data.path, A, { contentType: 'image/jpeg', upsert: false })
      if (!up.error) break
      if (!/fetch failed|Failed to fetch/.test(up.error.message || '')) break
      // Transport-only fixture retry: reconcile exact immutable key if upload reached Storage.
      const existing = await admin.storage
        .from('listing-images')
        .info(m.data.path)
      if (!existing.error) {
        assert.equal(sha(await download('listing-images', m.data.path)), sha(A))
        up = { error: null }
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
    assert(
      !up.error,
      'Synthetic public upload failed: ' +
        (up.error?.statusCode || '') +
        ' ' +
        (up.error?.message || '')
    )
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
  if (!createOffer) return { lid, conversationId: c.data.id, images }
  const off = await clients[0].rpc('marketplace_create_offer', {
    p_conversation_id: c.data.id,
    p_terms: {
      item_amount_cents: 7500,
      ...(mode === 'on_campus'
        ? {
            fulfillment: 'on_campus',
            meetup_location: 'Synthetic campus library',
            scheduled_at: new Date(
              Math.ceil((Date.now() + 6 * 3600000) / 900000) * 900000
            ).toISOString(),
          }
        : {
            fulfillment: 'delivery',
            delivery_fee_cents: 0,
            delivery_method: 'courier',
            delivery_area: {
              country_code: 'CA',
              province_code: 'ON',
              city_label: 'London',
              postal_prefix: 'N6A',
            },
          }),
      note: 'C2 isolated',
    },
    p_client_action_id: crypto.randomUUID(),
  })
  assert(!off.error)
  offers.push(off.data.id)
  journal()
  return { lid, offer: off.data.id, images }
}
async function prepareOnce(f, command = crypto.randomUUID(), who = 1) {
  const tracked = await rpc('marketplace_prepare_order_media', {
    p_offer: f.offer,
    p_actor: users[who],
    p_command: command,
  })
  if (!batches.includes(tracked.id)) {
    batches.push(tracked.id)
    privatePaths.push(...tracked.assets.map((a) => a.path))
    journal()
  }
  const b = await service.prepareOrderSnapshotMedia(
    clients[who],
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
async function prepare(f, command = crypto.randomUUID(), who = 1) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await prepareOnce(f, command, who)
    } catch (error) {
      if (error.message !== 'Snapshot upload failed. Retry.' || attempt === 2)
        throw error
      console.log(
        'Synthetic private media transport retry; same immutable command/batch'
      )
    }
  }
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
    const uploaded = await query(
      `select path from public.listing_images where listing_id in(${set(
        listings
      )});`
    )
    for (const row of uploaded)
      if (!publicPaths.includes(row.path)) publicPaths.push(row.path)
    // Real UI Accept creates its media batch on the server, outside prepare().
    const media = await query(
      `select b.id,a.path from marketplace_private.order_media_batches b left join marketplace_private.order_media_assets a on a.batch_id=b.id where b.listing_id in(${set(
        listings
      )});`
    )
    for (const row of media) {
      if (!batches.includes(row.id)) batches.push(row.id)
      if (row.path && !privatePaths.includes(row.path))
        privatePaths.push(row.path)
    }
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
  )})) then raise exception 'Fixture scope mismatch';end if;
if exists(select 1 from public.conversations where listing_id in(${lids}) and (buyer_id is null or seller_id is null or buyer_id not in(${
    users.length ? set(users) : 'null'
  }) or seller_id not in(${
    users.length ? set(users) : 'null'
  }))) then raise exception 'Foreign participant touched synthetic listing; cleanup stopped';end if;
end$$;
alter table public.order_meetup_revisions disable trigger order_meetup_guard;
-- New backend sidecars are removed only inside this exact synthetic graph.
alter table marketplace_private.v2_order_economics disable trigger v2_order_economics_immutable;
delete from public.notifications where recipient_user_id in(${
    users.length ? set(users) : 'null'
  });
delete from marketplace_private.notification_events where destination->>'orderId' in(select id::text from public.orders where listing_id in(${lids}))
 or destination->>'conversationId' in(select id::text from public.conversations where listing_id in(${lids}))
 or destination->>'listingId' in(${lids});
delete from marketplace_private.notification_events e where exists(select 1 from public.profiles p where p.id in(${
    users.length ? set(users) : 'null'
  }) and e.source_key like 'payout-capability:'||p.id::text||':%');
delete from marketplace_private.notification_reminders where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.buyer_receipt_commands where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.courier_commands where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.courier_shipments where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.protection_cases where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.order_protection where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.handoff_authorizations where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.delivery_checkouts where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.v2_order_economics where order_id in(select id from public.orders where listing_id in(${lids}));
alter table marketplace_private.v2_order_economics enable trigger v2_order_economics_immutable;
delete from marketplace_private.campus_payment_attempts where order_id in(select id from public.orders where listing_id in(${lids}));delete from marketplace_private.campus_inspections where order_id in(select id from public.orders where listing_id in(${lids}));delete from marketplace_private.meetup_commands where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.meetup_expiries where order_id in(select id from public.orders where listing_id in(${lids}));
delete from public.order_meetup_revisions where order_id in(select id from public.orders where listing_id in(${lids}));
delete from marketplace_private.order_snapshot_media where order_id in(${
    orders.length ? set(orders) : 'null'
  });
delete from marketplace_private.order_media_commands where batch_id in(${bids});delete from marketplace_private.order_media_assets where batch_id in(${bids});delete from marketplace_private.order_media_batches where id in(${bids});
alter table public.transaction_events disable trigger transaction_events_immutable;alter table public.orders disable trigger orders_immutable;alter table public.order_requests disable trigger order_request_immutable;alter table public.listings disable trigger listings_publication_boundary;alter table public.listings disable trigger listings_inventory_guard;
update public.listings set status='available',reserved_order_id=null where id in(${lids});delete from marketplace_private.offer_accept_commands where offer_id in(select id from public.order_requests where listing_id in(${lids}));delete from public.transaction_events where request_id in(select id from public.order_requests where listing_id in(${lids}));delete from marketplace_private.offer_commands where offer_id in(select id from public.order_requests where listing_id in(${lids}));delete from marketplace_private.order_commands where request_id in(select id from public.order_requests where listing_id in(${lids}));delete from public.orders where id in(${
    orders.length ? set(orders) : 'null'
  });delete from public.order_requests where listing_id in(${lids});delete from public.conversations where listing_id in(${lids});delete from public.listings where id in(${lids});
set constraints all immediate;alter table public.order_meetup_revisions enable trigger order_meetup_guard;alter table public.listings enable trigger listings_inventory_guard;alter table public.listings enable trigger listings_publication_boundary;alter table public.order_requests enable trigger order_request_immutable;alter table public.orders enable trigger orders_immutable;alter table public.transaction_events enable trigger transaction_events_immutable;commit;`)
  for (const [b, paths] of [
    ['listing-images', publicPaths],
    [bucket, privatePaths],
  ])
    if (paths.length)
      assert(
        !(await admin.storage.from(b).remove(paths)).error,
        'Scoped Storage cleanup'
      )
  for (const u of users) {
    const result = await admin.auth.admin.deleteUser(u)
    assert(
      !result.error || result.error.status === 404,
      'Synthetic Auth cleanup'
    )
  }
  const left = await query(
    `select count(*) count from storage.objects where (bucket_id='listing-images' and name in(${
      publicPaths.length ? set(publicPaths) : 'null'
    })) or(bucket_id=${q(bucket)} and name in(${
      privatePaths.length ? set(privatePaths) : 'null'
    }));`
  )
  assert.equal(left[0].count, 0)
  const remaining = await query(
    `select (select count(*) from auth.users where id in(${
      users.length ? set(users) : 'null'
    })) auth_users,(select count(*) from public.profiles where id in(${
      users.length ? set(users) : 'null'
    })) profiles,(select count(*) from public.listings where id in(${lids})) listings,(select count(*) from public.order_requests where listing_id in(${lids})) offers,(select count(*) from public.orders where listing_id in(${lids})) orders,(select count(*) from marketplace_private.order_media_batches where listing_id in(${lids})) media_batches;`
  )
  assert(
    Object.values(remaining[0]).every((value) => Number(value) === 0),
    'Synthetic fixture graph fully removed'
  )
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
  assert(
    !r.error,
    'Scoped capability setup: ' + (r.error?.code || 'transport/unclassified')
  )
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

const accounts = []
async function setup() {
  for (let i = 0; i < 4; i++) {
    const token = crypto.randomUUID(),
      email = `d1meetup_${token}@uwo.ca`,
      password = crypto.randomUUID() + 'aA1!'
    const u = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        username: 'D1_' + token.replaceAll('-', '').slice(0, 12),
      },
    })
    assert(!u.error)
    users.push(u.data.user.id)
    accounts.push({ email, password })
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
}
async function accepted(mode = 'on_campus', competing = false) {
  const f = await fixture(mode)
  if (competing) {
    const convo = await clients[2].rpc(
      'marketplace_find_or_create_conversation',
      { p_listing_id: f.lid }
    )
    assert(!convo.error)
    const r = await clients[0].rpc('marketplace_create_offer', {
      p_conversation_id: convo.data.id,
      p_terms: {
        item_amount_cents: 7400,
        fulfillment: 'on_campus',
        meetup_location: 'Synthetic competing campus meetup',
        scheduled_at: new Date(
          Math.ceil((Date.now() + 6 * 3600000) / 900000) * 900000
        ).toISOString(),
        note: 'Synthetic competitor',
      },
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!r.error, r.error?.message)
    offers.push(r.data.id)
    f.competingOfferId = r.data.id
    journal()
  }
  const b = await prepare(f),
    r = await accept(f, b)
  assert(!r.error, r.error?.message)
  orders.push(r.data.id)
  journal()
  return { ...f, order: r.data }
}
module.exports = {
  setup,
  accepted,
  fixture,
  prepare,
  accept,
  capability,
  query,
  fingerprint,
  cleanup,
  q,
  set,
  clients,
  users,
  accounts,
  admin,
  env,
  root,
  report,
  passed,
  journal,
  orders,
  offers,
  listings,
  identity: null,
}

async function recover() {
  const scope = JSON.parse(fs.readFileSync(root + '/scope.json', 'utf8'))
  assert(scope.marker.startsWith('D1Meetup_'))
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
  const recoveryBaseline = path.join(root, 'qualification-baseline.json')
  if (fs.existsSync(recoveryBaseline))
    assert.deepEqual(
      await fingerprint(),
      JSON.parse(fs.readFileSync(recoveryBaseline, 'utf8'))
    )
  console.log(
    fs.existsSync(recoveryBaseline)
      ? 'D1 exact recovery complete; canonical/manual/media baseline unchanged'
      : 'D1 exact journal-scoped recovery complete; no original baseline file available'
  )
}
module.exports.recover = recover
if (require.main === module && process.argv[2] === 'recover')
  recover().catch((e) => {
    console.error(e.message)
    process.exitCode = 1
  })
