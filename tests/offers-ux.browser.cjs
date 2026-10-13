/* global fetch, document, innerHeight, matchMedia, window */
// Real independent staging transactions; no canonical fixture or application changes.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const ref = 'pcaqxezdfxofysghssyo'
const root = path.resolve('tests/artifacts/offer-v2-b-browser')
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
const { createClient } = require('@supabase/supabase-js')
let marker = 'B Offer UI ' + crypto.randomUUID()
const listings = []
const report = { project: ref }
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
  'public.message_images',
  'public.image_message_submissions',
  'marketplace_private.chat_image_cleanup',
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
async function cleanup() {
  await Promise.allSettled([...pending])
  const chatPaths = users.length
    ? (
        await query(
          `select manifest from public.image_message_submissions where sender_id in(${ids(
            users
          )});`
        )
      ).flatMap((r) => r.manifest.map((slot) => slot.storage_path))
    : []
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
  if (chatPaths.length) {
    const admin = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    const removed = await admin.storage.from('chat-images').remove(chatPaths)
    assert(!removed.error)
    await query(
      `update marketplace_private.chat_image_cleanup set queued_at=clock_timestamp()-interval '11 minutes' where storage_path in(${ids(
        chatPaths
      )});`
    )
    for (const item of chatPaths) {
      const ack = await admin.rpc('marketplace_ack_chat_image_cleanup', {
        p_storage_path: item,
      })
      assert(!ack.error && ack.data === true)
    }
    const leftover = (
      await query(
        `select (select count(*) from storage.objects where bucket_id='chat-images' and name in(${ids(
          chatPaths
        )})) objects,(select count(*) from marketplace_private.chat_image_cleanup where storage_path in(${ids(
          chatPaths
        )})) queue;`
      )
    )[0]
    assert.equal(leftover.objects, 0)
    assert.equal(leftover.queue, 0)
  }
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
  await query(
    `begin;${actor(
      buyer
    )} select public.marketplace_send_text('${cid}',gen_random_uuid(),'Can we meet outside Weldon?');commit;`
  )
  return { lid, cid, rid }
}
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
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
    return
  }
  const html = await fetch(base + '/home').then((r) => r.text())
  let stage = false
  for (const match of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const code = (
      await fetch(new URL(match[1], base)).then((r) => r.text())
    ).replaceAll(String.fromCharCode(92, 34), '"')
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs/.test(
        code
      )
    )
    stage ||= code.includes('https://pcaqxezdfxofysghssyo.supabase.co')
  }
  assert(stage)
  const before = await fingerprint()
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const contexts = [],
    pages = []
  let errors = 0
  const writes = []
  const joins = [0, 0]
  let failedRefresh = false
  journal()
  try {
    const claims = JSON.parse(
      Buffer.from(env.SUPABASE_SERVICE_ROLE_KEY.split('.')[1], 'base64url')
    )
    assert.equal(claims.ref, ref)
    assert.equal(claims.role, 'service_role')
    const admin = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } }
    )
    for (let i = 0; i < 2; i++) {
      const token = crypto.randomUUID(),
        email = `bux_${token}@uwo.ca`,
        password = crypto.randomUUID() + 'aA1!'
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          username: 'Bux_' + token.replaceAll('-', '').slice(0, 12),
        },
      })
      assert(!error && data.user)
      users.push(data.user.id)
      accounts.push({ email, password })
      journal()
    }
    seller = users[0]
    buyer = users[1]
    await query(
      `select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test','bux','bux','Test Bank','6789');`
    )
    const f = await fixture()
    await query(
      `select public.marketplace_record_financial_capability('${seller}','payout_account','unset',null,null,null,null,null);`
    )
    for (let i = 0; i < 2; i++) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: 'America/Toronto',
        serviceWorkers: 'allow',
        reducedMotion: 'reduce',
      })
      await context.addInitScript(() => {
        const originalFetch = window.fetch.bind(window)
        window.fetch = (input, options) => {
          const url = new URL(
            typeof input === 'string' ? input : input.url,
            window.location.origin
          )
          if (
            window.__failOfferRefresh &&
            url.pathname === '/api/offers' &&
            (!options?.method || options.method === 'GET')
          )
            return Promise.resolve(
              new Response(
                JSON.stringify({ error: 'Forced refresh failure' }),
                { status: 503, headers: { 'Content-Type': 'application/json' } }
              )
            )
          return originalFetch(input, options)
        }
      })
      contexts.push(context)
      await context.route('**/*', (route) => {
        const req = route.request(),
          u = new URL(req.url())
        if (![base, env.NEXT_PUBLIC_SUPABASE_URL].includes(u.origin))
          return route.abort()
        if (req.method() !== 'GET' && u.origin === base) writes.push(u.pathname)
        if (
          i === 1 &&
          failedRefresh &&
          u.pathname === '/api/offers' &&
          req.method() === 'GET'
        )
          return route.fulfill({
            status: 503,
            json: { error: 'Forced refresh failure' },
          })
        return route.continue()
      })
      const login = await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: accounts[i],
      })
      assert.equal(login.status(), 200)
      const page = await context.newPage()
      pages.push(page)
      page.on('console', (message) => {
        if (message.type() !== 'error') return
        if (
          /TypeError|ReferenceError|SyntaxError|A client-side exception/.test(
            message.text()
          )
        )
          errors++
        const safe = message
          .text()
          .replace(
            /[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/g,
            '[JWT redacted]'
          )
          .replace(
            /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,
            '[email redacted]'
          )
        fs.appendFileSync(
          path.join(root, 'console-errors.txt'),
          safe + '\n' + JSON.stringify(message.location()) + '\n'
        )
      })
      page.on('pageerror', (e) => {
        errors++
        fs.appendFileSync(path.join(root, 'runtime-errors.txt'), e.stack + '\n')
        console.log('Runtime:', e.message)
      })
      page.on('websocket', (ws) =>
        ws.on('framesent', ({ payload }) => {
          try {
            const v = JSON.parse(payload.toString())
            if ((Array.isArray(v) ? v[3] : v.event) === 'phx_join') joins[i]++
          } catch {
            /* Non-JSON websocket transport frame. */
          }
        })
      )
      await page.goto(
        `${base}/home?section=messages&destination=${
          i === 0 ? 'selling' : 'buying'
        }&conversation=${f.cid}`
      )
      await page
        .locator(`[data-conversation-id="${f.cid}"]`)
        .first()
        .waitFor({ timeout: 60000 })
      await page.locator(`[data-conversation-id="${f.cid}"]`).first().click()
      await page
        .getByRole('region', { name: 'Chat messages', exact: true })
        .waitFor()
      await page.waitForFunction(() =>
        document.querySelector('[data-message-history]')
      )
    }
    console.log('PASS two authenticated staging contexts mounted')
    const [sp, bp] = pages
    const button = (page, name) =>
      page.getByRole('button', { name, exact: true })
    const editor = (page) =>
      page.getByRole('dialog', {
        name: /Make an Offer|Counter Offer|Revise Offer/,
      })
    const card = (page, id) => page.locator(`[data-offer-id="${id}"]`)
    const history = async () => {
      const r = await contexts[1].request.get(
        base + '/api/offers?conversationId=' + f.cid
      )
      assert.equal(r.status(), 200)
      return (await r.json()).offers
    }
    const menu = async (page, name) => {
      await button(page, 'Add to conversation').click()
      await button(page, name).click()
      await editor(page).waitFor()
    }
    const submit = async (page, label) => {
      await button(page, 'Review Offer').click()
      const confirm = page.getByRole('dialog', {
        name: 'Review your Offer',
        exact: true,
      })
      await confirm.waitFor()
      await confirm.getByRole('button', { name: label, exact: true }).click()
      await confirm.waitFor({ state: 'detached' })
    }
    await bp.goto(base + '/listings/' + f.lid)
    await button(bp, 'Make Offer').waitFor()
    await button(bp, 'Make Offer').click()
    console.log('Listing Make Offer navigation', new URL(bp.url()).pathname)
    await editor(bp).waitFor()
    assert(bp.url().includes('conversation=' + f.cid))
    await editor(bp).getByLabel('Offer price (CA$)', { exact: true }).fill('70')
    await button(bp, 'On Campus').click()
    await editor(bp)
      .getByLabel('Meetup location', { exact: true })
      .fill('Outside Weldon')
    const key = await bp.evaluate(() => {
      const d = new Date()
      d.setDate(d.getDate() + 3)
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(
        2,
        '0'
      )}-${String(d.getDate()).padStart(2, '0')}`
    })
    await editor(bp)
      .getByRole('button', { name: /^Date / })
      .click()
    const calendar = bp.getByRole('dialog', {
      name: 'Schedule calendar',
      exact: true,
    })
    if (!(await calendar.locator(`[data-day="${key}"] button`).count()))
      await calendar.getByRole('button', { name: /next month/i }).click()
    await calendar.locator(`[data-day="${key}"] button`).click()
    await editor(bp)
      .getByRole('button', { name: /^Time / })
      .click()
    await bp
      .getByRole('dialog', { name: 'Choose time', exact: true })
      .getByRole('button', { name: 'Done', exact: true })
      .click()
    await submit(bp, 'Send Offer')
    let h = await history()
    const first = h.at(-1)
    assert.equal(first.terms.fulfillment, 'on_campus')
    assert.equal(first.terms.itemAmountCents, 7000)
    await card(sp, first.id).waitFor()
    assert.equal(
      await card(bp, first.id).locator('xpath=..').getAttribute('data-sent'),
      'true'
    )
    assert.equal(
      await card(sp, first.id).locator('xpath=..').getAttribute('data-sent'),
      'false'
    )
    await button(bp, 'Add to conversation').click()
    await button(bp, 'Attachment').click()
    const attachment = bp.locator('[data-attachment-panel]')
    await attachment.locator('input[type=file]').setInputFiles({
      name: 'synthetic-chair.jpg',
      mimeType: 'image/jpeg',
      buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
    })
    const finalized = bp.waitForResponse((r) =>
      /\/api\/messages\/images\/[^/]+\/finalize$/.test(
        new URL(r.url()).pathname
      )
    )
    await attachment.getByRole('button', { name: 'Send', exact: true }).click()
    const imageResponse = await finalized
    assert.equal(imageResponse.status(), 200)
    const imageMessage = await imageResponse.json()
    await bp.locator(`[data-message-id="${imageMessage.id}"]`).waitFor()
    await attachment.waitFor({ state: 'detached' })
    await sp.locator(`[data-message-id="${imageMessage.id}"]`).waitFor()
    console.log(
      'PASS real durable IMAGE upload and mixed TEXT/IMAGE/V1/V2 timeline'
    )
    await card(sp, first.id).getByRole('button').click()
    assert.equal(await button(sp, 'Withdraw Offer').count(), 0)
    assert.equal(await button(sp, 'Accept').count(), 0)
    await button(sp, 'Counter Offer').click()
    await sp
      .getByRole('dialog', { name: 'Set up payouts first', exact: true })
      .waitFor()
    await button(sp, 'Cancel').click()
    assert.equal(await card(sp, first.id).count(), 1)
    await query(
      `select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test','bux','bux','Test Bank','6789');`
    )
    await card(sp, first.id).getByRole('button').click()
    await button(sp, 'Counter Offer').click()
    assert.equal(
      await editor(sp)
        .getByLabel('Offer price (CA$)', { exact: true })
        .inputValue(),
      '70.00'
    )
    assert.equal(
      await editor(sp)
        .getByLabel('Meetup location', { exact: true })
        .inputValue(),
      'Outside Weldon'
    )
    await editor(sp).getByLabel('Offer price (CA$)', { exact: true }).fill('80')
    await submit(sp, 'Send Counter Offer')
    h = await history()
    const second = h.at(-1)
    assert.equal(h[0].status, 'Replaced')
    await card(bp, second.id).waitFor()
    assert.equal(
      await card(sp, second.id).locator('xpath=..').getAttribute('data-sent'),
      'true'
    )
    await card(bp, second.id).getByRole('button').click()
    await button(bp, 'Counter Offer').click()
    await editor(bp).getByLabel('Offer price (CA$)', { exact: true }).fill('75')
    await submit(bp, 'Send Counter Offer')
    h = await history()
    const third = h.at(-1)
    assert.deepEqual(
      h.map((x) => x.status),
      ['Replaced', 'Replaced', 'Active']
    )
    await card(sp, third.id).waitFor()
    // Real successful revision + forced authority refetch failure. No local fake status.
    await card(bp, third.id).getByRole('button').click()
    await button(bp, 'Revise Offer').click()
    assert.equal(
      await editor(bp)
        .getByLabel('Offer price (CA$)', { exact: true })
        .inputValue(),
      '75.00'
    )
    await button(bp, 'Delivery').click()
    await editor(bp)
      .getByLabel('Delivery fee (CA$)', { exact: true })
      .fill('10')
    await button(bp, 'Seller delivery').click()
    failedRefresh = true
    await bp.evaluate(() => {
      window.__failOfferRefresh = true
    })
    await submit(bp, 'Send Revised Offer')
    await bp
      .getByRole('button', { name: 'Retry Offers', exact: true })
      .waitFor()
    await button(bp, 'Add to conversation').click()
    assert.equal(await button(bp, 'Revise Offer').count(), 0)
    await button(bp, 'Add to conversation').click()
    failedRefresh = false
    await bp.evaluate(() => {
      window.__failOfferRefresh = false
    })
    await button(bp, 'Retry Offers').click()
    h = await history()
    const fourth = h.at(-1)
    await card(bp, fourth.id).waitFor()
    assert.equal(fourth.terms.deliveryFeeCents, 1000)
    assert.equal(h[2].terms.fulfillment, 'on_campus')
    assert.equal(h.length, 4)
    await card(sp, fourth.id).waitFor()
    await card(sp, fourth.id).getByRole('button').click()
    await button(sp, 'Counter Offer').click()
    assert.equal(
      await editor(sp)
        .getByLabel('Delivery fee (CA$)', { exact: true })
        .inputValue(),
      '10.00'
    )
    await editor(sp).getByLabel('Offer price (CA$)', { exact: true }).fill('85')
    await editor(sp).getByLabel('Delivery fee (CA$)', { exact: true }).fill('5')
    await submit(sp, 'Send Counter Offer')
    h = await history()
    const fifth = h.at(-1)
    await card(bp, fifth.id).waitFor()
    await query(
      `select public.marketplace_record_financial_capability('${seller}','payout_account','needs_attention','staging_test','bux','bux','Test Bank','6789');`
    )
    await card(sp, fifth.id).getByRole('button').click()
    await button(sp, 'Withdraw Offer').click()
    await button(sp, 'Keep offer').click()
    assert.equal((await history()).at(-1).status, 'Active')
    await button(sp, 'Withdraw Offer').click()
    await button(sp, 'Withdraw offer').click()
    await card(bp, fifth.id).locator('[data-offer-status]').count()
    await bp.waitForFunction(
      (id) =>
        document
          .querySelector(`[data-offer-id="${id}"]`)
          ?.getAttribute('data-offer-status') === 'Withdrawn',
      fifth.id
    )
    assert.equal((await history()).at(-1).status, 'Withdrawn')
    await query(
      `select public.marketplace_record_financial_capability('${seller}','payout_account','ready','staging_test','bux','bux','Test Bank','6789');`
    )
    console.log(
      'PASS two-session On Campus/Delivery counter/revision, failed refetch recovery, sender withdrawal after payout downgrade'
    )
    await menu(sp, 'Send Offer')
    await editor(sp).getByLabel('Offer price (CA$)', { exact: true }).fill('82')
    await button(sp, 'Delivery').click()
    await editor(sp).getByLabel('Delivery fee (CA$)', { exact: true }).fill('0')
    await button(sp, 'Courier / shipping').click()
    await submit(sp, 'Send Offer')
    const sixth = (await history()).at(-1)
    assert.equal(sixth.senderId, seller)
    await card(bp, sixth.id).waitFor()
    await card(sp, sixth.id).getByRole('button').click()
    assert.equal(await button(sp, 'Counter Offer').count(), 0)
    await button(sp, 'Revise Offer').click()
    assert.equal(
      await editor(sp)
        .getByLabel('Offer price (CA$)', { exact: true })
        .inputValue(),
      '82.00'
    )
    await editor(sp).getByLabel('Offer price (CA$)', { exact: true }).fill('83')
    await submit(sp, 'Send Revised Offer')
    const seventh = (await history()).at(-1)
    await card(bp, seventh.id).waitFor()
    assert.equal(
      (await history()).find((o) => o.id === sixth.id).status,
      'Replaced'
    )
    await card(sp, seventh.id).getByRole('button').click()
    await button(sp, 'Withdraw Offer').click()
    await button(sp, 'Withdraw offer').click()
    await bp.waitForFunction(
      (id) =>
        document
          .querySelector(`[data-offer-id="${id}"]`)
          ?.getAttribute('data-offer-status') === 'Withdrawn',
      seventh.id
    )
    console.log('PASS Seller initial Offer and same-sender revision')
    const writesBeforeForms = writes.filter((p) =>
      p.startsWith('/api/offers')
    ).length
    const matrix = []
    for (const width of [390, 430, 1280, 1536]) {
      await bp.setViewportSize({ width, height: 900 })
      await card(bp, fifth.id).getByRole('button').click()
      const detail = bp.getByRole('dialog', {
        name: /^Offer.*Withdrawn$/,
        exact: true,
      })
      await detail.waitFor()
      await detail.getByRole('button', { name: 'Close', exact: true }).focus()
      assert(await detail.evaluate((node) => node.matches(':modal')))
      await bp.keyboard.press('Tab')
      // Chrome permits native modal keyboard traversal through browser chrome;
      // a second Tab returns to its sole control, never the background app.
      if (await bp.evaluate(() => document.activeElement === document.body))
        await bp.keyboard.press('Tab')
      assert(
        await detail.evaluate((node) => node.contains(document.activeElement))
      )
      assert(
        await bp.evaluate(
          () => matchMedia('(prefers-reduced-motion: reduce)').matches
        )
      )
      const metrics = await detail.evaluate((node) => ({
        horizontal: node.scrollWidth > node.clientWidth + 2,
        scroll: node.scrollHeight > node.clientHeight + 2,
        footer:
          node.querySelector('button')?.getBoundingClientRect().bottom <=
          innerHeight,
      }))
      assert(!metrics.horizontal)
      if (width >= 1280) assert(!metrics.scroll)
      assert(metrics.footer)
      assert.equal(await button(bp, 'Counter Offer').count(), 0)
      await button(bp, 'Close').click()
      await menu(bp, 'Make Offer')
      await button(bp, /^Asking price.*CA\$80\.00$/).click()
      await button(bp, 'Delivery').click()
      await editor(bp)
        .getByLabel('Delivery fee (CA$)', { exact: true })
        .fill('0')
      await button(bp, 'Courier / shipping').click()
      await button(bp, 'On Campus').click()
      assert.equal(
        await editor(bp)
          .getByLabel('Delivery fee (CA$)', { exact: true })
          .count(),
        0
      )
      await button(bp, 'Delivery').click()
      assert.equal(
        await editor(bp)
          .getByLabel('Delivery fee (CA$)', { exact: true })
          .inputValue(),
        '0'
      )
      assert.equal(
        await editor(bp).getByLabel('Meetup location', { exact: true }).count(),
        0
      )
      assert.equal(
        await editor(bp)
          .getByLabel(/address/i)
          .count(),
        0
      )
      await bp.keyboard.press('Escape')
      await button(bp, 'Keep editing').click()
      await bp.keyboard.press('Escape')
      await button(bp, 'Discard').click()
      await sp.setViewportSize({ width, height: 900 })
      await menu(sp, 'Send Offer')
      await button(sp, 'Cancel').click()
      matrix.push({ width, ...metrics, forms: true })
    }
    assert.equal(
      writes.filter((p) => p.startsWith('/api/offers')).length,
      writesBeforeForms
    )
    await sp.goto(base + '/listings/' + f.lid)
    await sp.getByRole('heading', { name: marker }).waitFor()
    assert.equal(await button(sp, 'Make Offer').count(), 0)
    await sp.goto(
      `${base}/home?section=messages&destination=selling&conversation=${f.cid}`
    )
    await card(sp, seventh.id).waitFor()
    await bp.goto(
      `${base}/home?section=messages&destination=buying&conversation=${f.cid}`
    )
    await card(bp, fifth.id).waitFor()
    await bp.reload()
    await card(bp, fifth.id).waitFor()
    assert.equal((await history()).length, 7)
    assert.equal(await bp.locator('[data-timeline-request]').count(), 1)
    const state = (
      await query(
        `select (select count(*) from public.orders where conversation_id='${f.cid}') orders,(select status from public.listings where id='${f.lid}') listing,(select count(*) from public.conversations where listing_id='${f.lid}') conversations;`
      )
    )[0]
    assert.equal(state.orders, 0)
    assert.equal(state.listing, 'available')
    assert.equal(state.conversations, 1)
    assert.equal(errors, 0)
    assert(joins.every((n) => n >= 1))
    assert(!writes.some((p) => /\/orders|\/accept/.test(p)))
    Object.assign(report, {
      matrix,
      state,
      realtime: joins,
      runtimeErrors: errors,
      staleRecovery: true,
      offers: 7,
      sellerInitialAndRevise: true,
      reducedMotionAndKeyboard: true,
      withdrawn: true,
      zeroAccept: true,
    })
  } catch (error) {
    for (let i = 0; i < pages.length; i++) {
      fs.writeFileSync(
        path.join(root, `failure-${i}.txt`),
        await pages[i]
          .locator('body')
          .innerText()
          .catch(() => '')
      )
    }
    throw error
  } finally {
    for (const c of contexts) await c.close()
    await browser.close()
    await cleanup()
    assert.deepEqual(await fingerprint(), before)
    report.cleanup = true
    fs.writeFileSync(
      path.join(root, 'results.json'),
      JSON.stringify(report, null, 2)
    )
    console.log(JSON.stringify(report))
  }
}
main().catch((error) => {
  console.error(error.message.split('Call log:')[0])
  console.error(
    error.stack
      ?.split('\n')
      .filter((l) => l.includes('at main'))
      .join('\n')
  )
  process.exitCode = 1
})
