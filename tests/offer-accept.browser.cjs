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
  root = path.resolve('tests/artifacts/offer-accept-c2-browser'),
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
const accounts = []
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
  if (listings.length) {
    const actualBatches = await query(
      `select b.id,a.path from marketplace_private.order_media_batches b join marketplace_private.order_media_assets a on a.batch_id=b.id where b.listing_id in(${set(
        listings
      )});`
    )
    for (const row of actualBatches) {
      if (!batches.includes(row.id)) batches.push(row.id)
      if (!privatePaths.includes(row.path)) privatePaths.push(row.path)
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
const { chromium } = require(path.resolve(
  'tests/artifacts/browser-tools/node_modules/playwright-core'
))
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
  let browser
  const contexts = []
  let runtimeErrors = 0
  const pageErrors = []
  try {
    const home = await fetch('http://localhost:3000')
    assert.equal(home.status, 200)
    assert((await home.text()).includes(ref))
    for (let i = 0; i < 3; i++) {
      const token = crypto.randomUUID(),
        email = `c2ui_${token}@uwo.ca`,
        password = crypto.randomUUID() + 'aA1!'
      const u = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: 'C2u_' + token.replaceAll('-', '').slice(0, 12),
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
    const f = await fixture()
    const cid = (
      await query(
        `select conversation_id from public.order_requests where id=${q(
          f.offer
        )};`
      )
    )[0].conversation_id
    const c2 = await clients[2].rpc('marketplace_find_or_create_conversation', {
      p_listing_id: f.lid,
    })
    assert(!c2.error)
    const off = await clients[0].rpc('marketplace_create_offer', {
      p_conversation_id: c2.data.id,
      p_terms: {
        item_amount_cents: 7300,
        fulfillment: 'delivery',
        delivery_fee_cents: 0,
        delivery_method: 'courier',
        note: 'Competing browser offer',
      },
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!off.error)
    offers.push(off.data.id)
    journal()
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
    const pages = []
    const joins = [0, 0, 0]
    for (let i = 0; i < 3; i++) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: 'America/Toronto',
        reducedMotion: 'reduce',
        serviceWorkers: 'allow',
      })
      contexts.push(context)
      await context.addInitScript(() => {
        const original = window.fetch.bind(window)
        window.fetch = (input, init) => {
          const url = new URL(
            typeof input === 'string' ? input : input.url,
            location.origin
          )
          if (
            window.__failOfferRefresh &&
            url.pathname === '/api/offers' &&
            (!init?.method || init.method === 'GET')
          )
            return Promise.resolve(
              new Response(
                JSON.stringify({ error: 'Forced refresh failure' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              )
            )
          return original(input, init)
        }
      })
      const login = await context.request.post(
        'http://localhost:3000/api/auth/sign-in',
        {
          headers: {
            Origin: 'http://localhost:3000',
            'X-Marketplace-Request': '1',
          },
          data: accounts[i],
        }
      )
      assert.equal(login.status(), 200)
      const page = await context.newPage()
      pages.push(page)
      page.on('pageerror', (e) => {
        runtimeErrors++
        pageErrors.push({ message: e.message, stack: e.stack })
      })
      page.on('websocket', (socket) =>
        socket.on('framesent', ({ payload }) => {
          if (
            typeof payload === 'string' &&
            payload.includes('phx_join') &&
            payload.includes('marketplace:messages:')
          )
            joins[i]++
        })
      )
      await page.goto(
        `http://localhost:3000/home?section=messages&destination=${
          i === 0 ? 'selling' : 'buying'
        }&conversation=${i === 2 ? c2.data.id : cid}`
      )
      await page
        .locator(`[data-conversation-id="${i === 2 ? c2.data.id : cid}"]`)
        .first()
        .waitFor({ timeout: 45000 })
      await page
        .locator(`[data-conversation-id="${i === 2 ? c2.data.id : cid}"]`)
        .first()
        .click()
      await page
        .locator(`[data-offer-id="${i === 2 ? off.data.id : f.offer}"]`)
        .waitFor({ timeout: 45000 })
    }
    const [seller, buyer, other] = pages
    const button = (p, name) => p.getByRole('button', { name, exact: true })
    await seller.locator(`[data-offer-id="${f.offer}"] button`).first().click()
    assert.equal(await button(seller, 'Accept').count(), 0)
    await button(seller, 'Close').last().click()
    for (const width of [390, 430, 1280, 1536]) {
      await buyer.setViewportSize({ width, height: 900 })
      await buyer.locator(`[data-offer-id="${f.offer}"] button`).first().click()
      await button(buyer, 'Accept').click()
      await buyer.getByRole('heading', { name: 'Accept this offer?' }).waitFor()
      assert.equal(await button(buyer, 'Accept & Reserve').count(), 1)
      const dialog = buyer.getByRole('dialog', { name: 'Accept this offer?' })
      assert(
        await dialog.evaluate((el) => {
          const style = getComputedStyle(el)
          return (
            parseFloat(style.paddingLeft) > 0 &&
            style.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
            el.scrollWidth <= el.clientWidth + 1
          )
        })
      )
      await buyer.keyboard.press('Tab')
      assert(await dialog.evaluate((el) => el.contains(document.activeElement)))

      assert(
        await buyer.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
      )
      await buyer.screenshot({ path: path.join(root, `accept-${width}.png`) })
      await button(buyer, 'Cancel').last().click()
      assert.equal((await facts(f)).order_count, 0)
      await button(buyer, 'Close').last().click()
    }
    await buyer.setViewportSize({ width: 1280, height: 900 })
    await buyer.locator(`[data-offer-id="${f.offer}"] button`).first().click()
    await button(buyer, 'Accept').click()
    if (process.argv[2] !== 'normal') {
      await buyer.evaluate(() => {
        window.__failOfferRefresh = true
        window.__realOrderNavigation = window.next.router.push
        window.next.router.push = async () => false
      })
    }
    const response = buyer.waitForResponse(
      (r) =>
        r.url().endsWith(`/api/offers/${f.offer}/accept`) &&
        r.request().method() === 'POST'
    )
    await button(buyer, 'Accept & Reserve').click()
    const receipt = await response
    assert.equal(receipt.status(), 200)
    const accepted = await receipt.json()
    orders.push(accepted.orderId)
    journal()
    const apiOrders = await contexts[1].request.get(
      'http://localhost:3000/api/orders?workspace=purchases'
    )
    const apiBody = await apiOrders.json()
    console.log(
      JSON.stringify({
        ordersApiStatus: apiOrders.status(),
        ordersCount: apiBody.orders?.length ?? null,
        error: apiBody.error || null,
        protocol: apiBody.orders?.[0]?.protocolVersion ?? null,
      })
    )
    assert.equal(apiOrders.status(), 200)

    if (process.argv[2] !== 'normal') {
      await button(buyer, 'Retry Offers').waitFor({ timeout: 45000 })
      assert.equal(await button(buyer, 'Accept').count(), 0)
      assert.equal(await button(buyer, 'Accept & Reserve').count(), 0)
      assert.equal((await facts(f)).order_count, 1)
      await buyer.evaluate(() => {
        window.__failOfferRefresh = false
        window.next.router.push = window.__realOrderNavigation
      })
      await button(buyer, 'Retry Offers').click()
      await buyer
        .locator(`[data-offer-id="${f.offer}"][data-offer-status="Accepted"]`)
        .waitFor({ timeout: 45000 })
      await buyer.locator(`[data-offer-id="${f.offer}"] button`).first().click()
      await button(buyer, 'View Order').click()
      passed(
        'successful-Accept-forced-history-failure-non-actionable-barrier-Retry-recovers'
      )
    }
    await buyer
      .locator(`[data-formal-order="${accepted.orderId}"]`)
      .waitFor({ timeout: 45000 })
    assert(buyer.url().includes('destination=purchases'))
    assert.equal(
      await buyer.getByText('Payment pending', { exact: true }).count(),
      1
    )
    assert.equal(await button(buyer, 'Pay now').count(), 0)
    assert.equal(await buyer.getByText(/reservation remaining/).count(), 0)
    await other
      .locator(`[data-offer-id="${off.data.id}"][data-offer-status="Closed"]`)
      .waitFor({ timeout: 45000 })
    await seller
      .locator(`[data-offer-id="${f.offer}"][data-offer-status="Accepted"]`)
      .waitFor({ timeout: 45000 })
    await seller.locator(`[data-offer-id="${f.offer}"] button`).first().click()
    await button(seller, 'View Order').click()
    await seller
      .locator(`[data-formal-order="${accepted.orderId}"]`)
      .waitFor({ timeout: 45000 })
    assert(seller.url().includes('destination=sales'))
    for (const page of [buyer, seller])
      for (const width of [390, 430, 1280, 1536]) {
        await page.setViewportSize({ width, height: 900 })
        await page
          .locator(`[data-formal-order="${accepted.orderId}"]`)
          .waitFor({ timeout: 45000 })
        await page.waitForFunction(
          () => document.documentElement.scrollWidth <= innerWidth + 1
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        await page.screenshot({
          path: path.join(
            root,
            `order-${page === buyer ? 'buyer' : 'seller'}-${width}.png`
          ),
        })
      }
    await buyer.evaluate(() => {
      window.__failOfferRefresh = false
    })
    await buyer.reload()
    await buyer
      .locator(`[data-formal-order="${accepted.orderId}"]`)
      .waitFor({ timeout: 45000 })
    assert.equal((await facts(f)).order_count, 1)
    const pending = await contexts[0].request.get(
      'http://localhost:3000/api/messages/conversations/' + cid
    )
    assert.equal(pending.status(), 200)
    await buyer.goto(
      `http://localhost:3000/home?section=messages&destination=buying&conversation=${cid}`
    )
    await buyer.locator(`[data-conversation-id="${cid}"]`).first().click()
    await buyer
      .locator(`[data-offer-id="${f.offer}"][data-offer-status="Accepted"]`)
      .waitFor({ timeout: 45000 })
    await buyer.locator(`[data-offer-id="${f.offer}"] button`).first().click()
    assert.equal(await button(buyer, 'Accept').count(), 0)
    await button(buyer, 'View Order').click()
    await buyer
      .locator(`[data-formal-order="${accepted.orderId}"]`)
      .waitFor({ timeout: 45000 })
    for (const width of [390, 430, 1280, 1536]) {
      await buyer.setViewportSize({ width, height: 900 })
      await buyer
        .locator(`[data-formal-order="${accepted.orderId}"]`)
        .waitFor({ timeout: 45000 })
      await button(buyer, 'Cancel order').click()
      await buyer.getByRole('heading', { name: 'Cancel this order?' }).waitFor()
      // Native top-layer dialog can inflate root scrollWidth by the scrollbar gutter;
      // verify the actual dialog bounds and content, rather than that browser metric.
      assert(
        await buyer
          .getByRole('dialog', { name: 'Cancel this order?' })
          .evaluate((el) => {
            const r = el.getBoundingClientRect()
            return (
              r.left >= 0 &&
              r.right <= innerWidth &&
              el.scrollWidth <= el.clientWidth + 1
            )
          })
      )
      await buyer.screenshot({ path: path.join(root, `cancel-${width}.png`) })
      await button(buyer, 'Keep order').click()
      await buyer
        .getByRole('dialog', { name: 'Cancel this order?' })
        .waitFor({ state: 'hidden' })
      assert.equal((await facts(f)).status, 'pending')
      await other.setViewportSize({ width, height: 900 })
      await other
        .locator(`[data-offer-id="${off.data.id}"] button`)
        .first()
        .click()
      assert.equal(await button(other, 'Accept').count(), 0)
      assert.equal(await button(other, 'Counter Offer').count(), 0)
      await other
        .getByText('Listing no longer available', { exact: true })
        .waitFor({ timeout: 15000 })
      await other.screenshot({ path: path.join(root, `closed-${width}.png`) })
      await button(other, 'Close').last().click()
      await other.getByRole('dialog').waitFor({ state: 'hidden' })
      console.log('PASS cancellation / Closed responsive ' + width)
    }
    const x = await fixture(),
      xcid = (
        await query(
          `select conversation_id from public.order_requests where id=${q(
            x.offer
          )};`
        )
      )[0].conversation_id
    const newOffer = await clients[1].rpc('marketplace_create_offer', {
      p_conversation_id: xcid,
      p_terms: {
        item_amount_cents: 7200,
        fulfillment: 'on_campus',
        meetup_location: 'Synthetic campus meetup',
        scheduled_at: new Date(
          Math.ceil((Date.now() + 6 * 3600000) / 900000) * 900000
        ).toISOString(),
        note: 'Inspection first',
      },
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!newOffer.error)
    offers.push(newOffer.data.id)
    journal()
    await seller.goto(
      `http://localhost:3000/home?section=messages&destination=selling&conversation=${xcid}`
    )
    await seller.locator(`[data-conversation-id="${xcid}"]`).first().click()
    await seller
      .locator(`[data-offer-id="${newOffer.data.id}"] button`)
      .first()
      .click()
    await button(seller, 'Accept').click()
    await seller
      .getByText(/You will inspect the item before payment/)
      .waitFor({ timeout: 15000 })
    await button(seller, 'Accept & Reserve').click()
    await seller
      .locator('[data-order-protocol="2"]')
      .waitFor({ timeout: 45000 })
    assert(seller.url().includes('destination=sales'))
    await seller
      .getByText('Payment will happen after in-person inspection.', {
        exact: true,
      })
      .waitFor({ timeout: 15000 })
    assert.equal(await seller.getByText(/reservation remaining/).count(), 0)
    passed(
      'Buyer-origin-On-Campus-Seller-Accept-direct-Sales-navigation-inspect-first-no-timers'
    )
    assert.equal(runtimeErrors, 0, JSON.stringify(pageErrors))
    assert(
      joins.every((n) => n >= 1),
      'Each mounted authenticated Messages context must join'
    )
    passed(
      'responsive-390-430-1280-1536-recipient-confirmation-cancel-zero-write'
    )
    passed(
      'real-Accept-API-private-media-exact-role-navigation-refresh-persistence'
    )
    passed(
      'three-party-Realtime-Accepted-Closed-invalidation-no-V1-timer-or-Pay'
    )
    report.runtimeErrors = runtimeErrors
    report.realtimeJoins = joins
  } catch (e) {
    failure = e
    console.log('Browser qualification failure: ' + e.stack)
    for (let i = 0; i < contexts.length; i++) {
      const page = contexts[i].pages()[0]
      if (!page) continue
      const diag = {
        index: i,
        url: page.url(),
        headings: await page.getByRole('heading').allTextContents(),
        alerts: await page.getByRole('alert').allTextContents(),
        runtimeErrors: pageErrors,
        layout: await page.evaluate(() => ({
          viewport: innerWidth,
          scroll: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('body *')]
            .filter((e) => {
              const r = e.getBoundingClientRect()
              return r.width > 0 && r.right > innerWidth + 1
            })
            .slice(0, 8)
            .map((e) => ({
              tag: e.tagName,
              cls: e.className,
              right: e.getBoundingClientRect().right,
            })),
        })),
      }
      fs.writeFileSync(
        path.join(root, `failure-ui-${i}.json`),
        JSON.stringify(diag, null, 2)
      )
      await page
        .screenshot({ path: path.join(root, `failure-${i}.png`) })
        .catch(() => {})
      console.log(JSON.stringify(diag))
    }
  } finally {
    for (const c of contexts) await c.close()
    if (browser) await browser.close()
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
