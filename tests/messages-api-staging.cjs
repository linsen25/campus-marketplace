/* global document, Navigator, innerWidth, fetch, CompositionEvent, KeyboardEvent */
// Opt-in real HTTP + GoTrue + PostgreSQL verification on the pinned hosted staging.
// Fixtures are administrative SQL-only metadata; application calls use real sessions.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const crypto = require('node:crypto')
const { spawn } = require('node:child_process')
const { chromium, request } = require(process.env.PLAYWRIGHT_MODULE)
const ref = 'pcaqxezdfxofysghssyo'
const base = process.env.HOME_TEST_URL || 'http://localhost:3100'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const id = (n) => 'f1c00000-0000-4000-8000-' + String(n).padStart(12, '0')
const users = [id(101), id(102), id(103)]
const listings = [1, 2, 3, 4, 5, 6, 7].map(id)
const password = crypto.randomBytes(24).toString('hex') + 'Aa!9'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-phase1c-'))
let counter = 0
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'cmd.exe',
      ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args],
      { windowsHide: true }
    )
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    // Do not log SQL responses on failure: fixture passwords live only in temp SQL.
    child.stderr.on('data', () => {})
    child.on('error', () => reject(new Error('Unable to launch staging CLI.')))
    child.on('close', (code) => {
      if (code)
        return reject(
          new Error('Staging CLI operation failed (response suppressed).')
        )
      try {
        resolve(JSON.parse(stdout.slice(stdout.indexOf('{'))))
      } catch {
        reject(new Error('Unexpected staging CLI result.'))
      }
    })
  })
}
function query(sql) {
  const filename = path.join(directory, `query-${counter++}.sql`)
  fs.writeFileSync(filename, sql)
  return cli([
    'db',
    'query',
    '--linked',
    '--project-ref',
    ref,
    '--file',
    filename,
  ])
}
const headers = { 'X-Marketplace-Request': '1' }
async function api(context, endpoint, data, expected = 200) {
  const response = await context[data === undefined ? 'get' : 'post'](
    base + endpoint,
    { headers, ...(data === undefined ? {} : { data }) }
  )
  assert.equal(
    response.status(),
    expected,
    `${endpoint}: expected ${expected}, received ${response.status()}`
  )
  assert.match(response.headers()['cache-control'], /no-store/)
  return response.json()
}
async function login(context, name) {
  await api(context, '/api/auth/sign-in', {
    email: `phase1c-${name}@uwo.ca`,
    password,
  })
  const session = await api(context, '/api/auth/session')
  assert.equal(
    session.seller.id,
    users[['seller', 'buyer', 'outsider'].indexOf(name)]
  )
}
async function main() {
  const projects = await cli(['projects', 'list'])
  const linked = projects.projects.filter((project) => project.linked)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].ref, ref)
  assert.equal(linked[0].name, 'western-marketplace-staging')
  // Verify the running app target independently of its CLI link before making fixtures.
  const settings = await fetch(base + '/api/messages/conversations?role=buying')
  assert.equal(
    settings.status,
    401,
    'Running staging API must reject an anonymous request, not a non-staging 503.'
  )
  const suite = fs.readFileSync('tests/messages-text-staging.sql', 'utf8')
  let setup = suite
    .slice(
      suite.indexOf('do $$\ndeclare seller uuid'),
      suite.indexOf('set local role authenticated;')
    )
    .replaceAll('f1b00000', 'f1c00000')
    .replaceAll('f1b10000', 'f1c10000')
    .replaceAll('Phase1B', 'Phase1C')
    .replaceAll('phase1b-', 'phase1c-')
    .replace('1..4', '1..7')
    .replace(
      "  update public.listings set status='sold' where id='f1c00000-0000-4000-8000-000000000004';",
      ''
    )
    .replace(
      '    lid :=',
      `    if n=7 then
      seller:=buyer;
      perform set_config('request.jwt.claim.sub',seller::text,true);
      perform set_config('request.jwt.claims',jsonb_build_object('sub',seller,'role','authenticated')::text,true);
    end if;
    lid :=`
    )
  setup += `update auth.users set encrypted_password=extensions.crypt('${password}',extensions.gen_salt('bf')),
    confirmation_token='',recovery_token='',email_change_token_new='',email_change='',email_change_token_current='',reauthentication_token=''
    where id in (${users.map((value) => `'${value}'`).join(',')});
    insert into auth.identities(user_id,provider_id,provider,identity_data,created_at,updated_at)
    select id,id::text,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now()
    from auth.users where id in (${users
      .map((value) => `'${value}'`)
      .join(',')});`
  let seeded = false
  let browser
  const contexts = []
  try {
    await query(`begin; ${setup} commit;`)
    seeded = true
    console.log('PASS staging-only fixture setup; production excluded')
    const buyer = await request.newContext(),
      seller = await request.newContext(),
      outsider = await request.newContext()
    contexts.push(buyer, seller, outsider)
    await login(buyer, 'buyer')
    await login(seller, 'seller')
    await login(outsider, 'outsider')
    console.log(
      'PASS real Western GoTrue password sessions via existing sign-in API'
    )
    const c = await api(buyer, '/api/messages/conversations', {
      listingId: id(1),
    })
    assert.equal(c.role, 'buying')
    assert.equal(c.listing.liveId, id(1))
    assert.equal(c.lastMessageSequence, 0)
    assert.equal(
      (await api(buyer, '/api/messages/conversations', { listingId: id(1) }))
        .id,
      c.id
    )
    const extra = []
    for (const n of [2, 4, 5, 6])
      extra.push(
        await api(buyer, '/api/messages/conversations', { listingId: id(n) })
      )
    const selling = await api(seller, '/api/messages/conversations', {
      listingId: id(7),
    })
    assert.equal(
      (await api(buyer, '/api/messages/conversations?role=selling'))
        .conversations[0].id,
      selling.id
    )
    await api(
      buyer,
      '/api/messages/conversations?role=buying&cursor=bnVsbA',
      undefined,
      400
    )
    const bought = await api(buyer, '/api/messages/conversations?role=buying')
    assert.equal(bought.conversations.length, 5)
    assert.equal(
      (await api(seller, '/api/messages/conversations?role=selling'))
        .conversations.length,
      5
    )
    await api(outsider, `/api/messages/conversations/${c.id}`, undefined, 404)
    await api(
      outsider,
      `/api/messages/conversations/${c.id}/messages`,
      undefined,
      404
    )
    await api(
      outsider,
      `/api/messages/conversations/${c.id}/messages`,
      {
        type: 'TEXT',
        content: 'No access',
        clientMessageId: crypto.randomUUID(),
      },
      404
    )
    await api(seller, '/api/messages/conversations', { listingId: id(1) }, 400)
    await api(buyer, '/api/messages/conversations', { listingId: id(3) }, 400)
    for (const content of ['', ' \n\t ', 'x'.repeat(2001)])
      await api(
        buyer,
        `/api/messages/conversations/${c.id}/messages`,
        { type: 'TEXT', content, clientMessageId: crypto.randomUUID() },
        400
      )
    await api(
      buyer,
      `/api/messages/conversations/${c.id}/messages`,
      { type: 'IMAGE', images: [], clientMessageId: crypto.randomUUID() },
      400
    )
    await api(
      buyer,
      `/api/messages/conversations/${c.id}/messages`,
      {
        type: 'TEXT',
        content: 'Spoof',
        senderId: users[0],
        clientMessageId: crypto.randomUUID(),
      },
      400
    )
    const nonce = crypto.randomUUID()
    const sent = await api(
      buyer,
      `/api/messages/conversations/${c.id}/messages`,
      { type: 'TEXT', content: '  Persisted\nTEXT  ', clientMessageId: nonce }
    )
    assert.equal(sent.sequence, 1)
    assert.equal(sent.content, 'Persisted\nTEXT')
    assert.equal(sent.senderId, users[1])
    const repeated = await api(
      buyer,
      `/api/messages/conversations/${c.id}/messages`,
      { type: 'TEXT', content: 'Persisted\nTEXT', clientMessageId: nonce }
    )
    assert.equal(repeated.id, sent.id)
    await api(
      buyer,
      `/api/messages/conversations/${c.id}/messages`,
      { type: 'TEXT', content: 'Different', clientMessageId: nonce },
      409
    )
    const reply = await api(
      seller,
      `/api/messages/conversations/${c.id}/messages`,
      {
        type: 'TEXT',
        content: 'Seller reply',
        clientMessageId: crypto.randomUUID(),
      }
    )
    assert.equal(reply.sequence, 2)
    assert.equal(
      (await api(buyer, `/api/messages/conversations/${c.id}`)).unreadCount,
      1
    )
    const activity = (await api(buyer, `/api/messages/conversations/${c.id}`))
      .activityAt
    const acknowledged = await api(
      buyer,
      `/api/messages/conversations/${c.id}/read`,
      { throughSequence: 1 }
    )
    assert.equal(acknowledged.unreadCount, 1)
    assert.equal(
      (
        await api(buyer, `/api/messages/conversations/${c.id}/read`, {
          throughSequence: 2,
        })
      ).unreadCount,
      0
    )
    assert.equal(
      (
        await api(buyer, `/api/messages/conversations/${c.id}/read`, {
          throughSequence: 1,
        })
      ).lastReadSequence,
      2
    )
    await api(
      buyer,
      `/api/messages/conversations/${c.id}/read`,
      { throughSequence: 3 },
      400
    )
    assert.equal(
      (await api(buyer, `/api/messages/conversations/${c.id}`)).activityAt,
      activity
    )
    console.log(
      'PASS find/create, roles, outsider, validation, canonical send/retry, read/unread/activity'
    )
    // Seed >50 real messages through the existing RPC under a test participant role.
    await query(`begin; set local role authenticated;
      select set_config('request.jwt.claim.sub','${users[0]}',true);
      select set_config('request.jwt.claims','{"sub":"${users[0]}","role":"authenticated"}',true);
      do $$ begin for n in 3..62 loop perform public.marketplace_send_text('${c.id}',gen_random_uuid(),'History '||n); end loop; end; $$; commit;`)
    const latest = await api(
      buyer,
      `/api/messages/conversations/${c.id}/messages`
    )
    assert.equal(latest.messages.length, 50)
    assert.equal(latest.messages[0].sequence, 13)
    assert.equal(latest.messages[49].sequence, 62)
    assert.equal(latest.nextBefore, 13)
    const old = await api(
      buyer,
      `/api/messages/conversations/${c.id}/messages?before=13`
    )
    assert.equal(old.messages.length, 12)
    assert.equal(old.messages[0].sequence, 1)
    assert.equal(old.nextBefore, null)
    const sold = extra[1],
      deleted = extra[0]
    await query(
      `begin; update public.listings set status='sold' where id='${id(
        4
      )}'; delete from public.listings where id='${id(2)}'; commit;`
    )
    const snapshot = await api(
      buyer,
      `/api/messages/conversations/${deleted.id}`
    )
    assert.equal(snapshot.listing.liveId, null)
    assert.equal(snapshot.listing.availability, 'deleted')
    assert.equal(snapshot.listing.title, 'Phase1C listing 2')
    assert.equal(snapshot.listing.live, undefined)
    await api(buyer, `/api/messages/conversations/${deleted.id}/messages`, {
      type: 'TEXT',
      content: 'Deleted listing chat remains',
      clientMessageId: crypto.randomUUID(),
    })
    await api(buyer, `/api/messages/conversations/${sold.id}/messages`, {
      type: 'TEXT',
      content: 'Sold listing chat remains',
      clientMessageId: crypto.randomUUID(),
    })
    await api(buyer, '/api/messages/conversations', { listingId: id(4) }, 400)
    console.log(
      'PASS sequence pagination and historical deleted/sold conversation access/send'
    )
    const unrelated = extra[3]
    await api(seller, `/api/messages/conversations/${unrelated.id}/messages`, {
      type: 'TEXT',
      content: 'Unread in another conversation',
      clientMessageId: crypto.randomUUID(),
    })
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE,
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    })
    fs.mkdirSync('tests/artifacts/messages-phase1c', { recursive: true })
    for (const width of [390, 430, 1280, 1536]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        storageState: await buyer.storageState(),
        serviceWorkers: 'block',
      })
      contexts.push(context)
      const page = await context.newPage()
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      await page.goto(
        `${base}/home?section=messages&destination=buying&conversation=${c.id}`,
        { waitUntil: 'domcontentloaded' }
      )
      const chat = page.getByRole('region', { name: 'Chat panel', exact: true })
      const history = page.getByRole('region', {
        name: 'Chat messages',
        exact: true,
      })
      await history
        .getByText('History 62', { exact: true })
        .waitFor({ timeout: 60000 })
      await page.waitForTimeout(500)
      assert.equal(await page.locator('[data-message-id]').count(), 50)
      assert(
        (await page.locator('[data-conversation-unread]').count()) > 0,
        'Unrelated unread dot remains'
      )
      assert.equal(
        (await api(buyer, `/api/messages/conversations/${unrelated.id}`))
          .unreadCount,
        1
      )
      if (width === 1280) {
        await history
          .getByRole('button', { name: 'Load older messages', exact: true })
          .click()
        await history.getByText('Persisted\nTEXT', { exact: true }).waitFor()
        assert((await page.locator('[data-message-id]').count()) > 50)
      }
      await page.screenshot({
        path: `tests/artifacts/messages-phase1c/${width}-normal.png`,
      })
      const box = chat.getByRole('textbox', { name: 'Message', exact: true })
      const outgoing = `Browser persistence ${width} ${crypto
        .randomUUID()
        .slice(0, 8)}`
      await box.fill(outgoing)
      await box.press('Enter')
      assert.equal(await box.inputValue(), '')
      await box.fill('New draft during send')
      await history.getByText(outgoing, { exact: true }).waitFor()
      assert.equal(await box.inputValue(), 'New draft during send')
      await box.fill('multiline')
      await box.press('Shift+Enter')
      await box.press('x')
      assert.equal(await box.inputValue(), 'multiline\nx')
      await chat.locator('[data-chat-send][data-state=idle]').waitFor()
      const beforeIme = await box.inputValue()
      await box.evaluate((el) => {
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            isComposing: true,
          })
        )
        el.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true })
        )
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            isComposing: false,
          })
        )
        el.dispatchEvent(
          new CompositionEvent('compositionend', { bubbles: true, data: 'IME' })
        )
      })
      assert.equal(await box.inputValue(), beforeIme)
      assert.equal(
        await history.getByText('multiline\nx', { exact: true }).count(),
        0
      )
      await page.screenshot({
        path: `tests/artifacts/messages-phase1c/${width}-text.png`,
      })
      await chat
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      const panel = page.locator('[data-attachment-panel]')
      await panel.waitFor()
      await page.waitForTimeout(400)
      assert(
        await panel
          .getByRole('button', { name: 'Send', exact: true })
          .isDisabled()
      )
      await panel
        .getByText('Image sending is not available yet.', { exact: false })
        .waitFor()
      const pending = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jqWQAAAAASUVORK5CYII=',
        'base64'
      )
      await panel.locator('input[type=file]').setInputFiles({
        name: 'local-only.png',
        mimeType: 'image/png',
        buffer: pending,
      })
      assert(
        await panel
          .getByRole('button', { name: 'Send', exact: true })
          .isDisabled()
      )
      const bounds = await page.evaluate(() => {
        const card = document
          .querySelector('[aria-label="Chat panel"]')
          .getBoundingClientRect()
        const panel = document
          .querySelector('[data-attachment-panel]')
          .getBoundingClientRect()
        return {
          contained: panel.top >= card.top && panel.bottom <= card.bottom + 1,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      assert(bounds.contained)
      assert(!bounds.overflow)
      await page.screenshot({
        path: `tests/artifacts/messages-phase1c/${width}-attachment.png`,
      })
      await panel
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      await panel.waitFor({ state: 'detached' })
      assert.equal(await box.inputValue(), '')
      if (width === 1280) {
        const endpoint = `**/api/messages/conversations/${c.id}/messages`
        const submission =
          'Lost response after real commit ' + crypto.randomUUID().slice(0, 8)
        let firstId
        let attempts = 0
        await page.route(endpoint, async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          const body = route.request().postDataJSON()
          if (body.content !== submission) return route.continue()
          attempts++
          if (attempts === 1) {
            firstId = body.clientMessageId
            const result = await route.fetch()
            assert.equal(result.status(), 200)
            return route.fulfill({
              status: 503,
              json: {
                error: 'Test: response lost after commit. Retry safely.',
              },
            })
          }
          assert.equal(
            body.clientMessageId,
            firstId,
            'Retry must retain the submission UUID'
          )
          return route.continue()
        })
        await box.fill(submission)
        await chat.locator('[data-chat-send][data-state=idle]').waitFor()
        await chat.getByRole('button', { name: 'Send', exact: true }).click()
        await chat.getByRole('alert').waitFor()
        assert.equal(await box.inputValue(), submission)
        await chat.locator('[data-chat-send][data-state=idle]').waitFor()
        await chat.getByRole('button', { name: 'Send', exact: true }).click()
        await history.getByText(submission, { exact: true }).waitFor()
        assert.equal(attempts, 2)
        const persisted = await api(
          buyer,
          `/api/messages/conversations/${c.id}/messages`
        )
        assert.equal(
          persisted.messages.filter((item) => item.content === submission)
            .length,
          1
        )
        await page.unroute(endpoint)
        let releaseFailure
        const held = new Promise((resolve) => {
          releaseFailure = resolve
        })
        await page.route(endpoint, async (route) => {
          if (route.request().method() !== 'POST') return route.continue()
          await held
          return route.fulfill({
            status: 503,
            json: { error: 'Test: temporary send failure.' },
          })
        })
        await chat.locator('[data-chat-send][data-state=idle]').waitFor()
        await box.fill('Failed old submission')
        await chat.getByRole('button', { name: 'Send', exact: true }).click()
        await box.fill('New draft protected on failure')
        releaseFailure()
        await chat.getByRole('alert').waitFor()
        assert.equal(await box.inputValue(), 'New draft protected on failure')
        await chat
          .getByText('Not sent: Failed old submission', { exact: true })
          .waitFor()
        assert.equal(
          await history
            .getByText('Failed old submission', { exact: true })
            .count(),
          0
        )
        await page.unroute(endpoint)
        console.log(
          'PASS browser lost-response retry: same nonce, one persisted row; new draft protected on failure'
        )
      }
      await chat
        .getByRole('button', { name: 'View listing', exact: true })
        .click()
      await page.getByRole('dialog', { name: 'Listing preview' }).waitFor()
      await page.getByRole('button', { name: 'Cancel', exact: true }).click()
      await page
        .getByRole('dialog', { name: 'Listing preview' })
        .waitFor({ state: 'detached' })
      if (width < 1024) {
        await page.getByRole('button', { name: 'Go Back', exact: true }).click()
        await page.waitForTimeout(400)
        await page.screenshot({
          path: `tests/artifacts/messages-phase1c/${width}-list.png`,
        })
        await page.getByRole('button').filter({ hasText: outgoing }).click()
        await history.getByText(outgoing, { exact: true }).waitFor()
      }
      const nav = page.locator(
        width < 1024 ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
      )
      const selectDestination = async (name) => {
        if (width < 1024) {
          const toggle = nav.getByRole('button', {
            name: 'Open Home navigation',
            exact: true,
          })
          if ((await toggle.getAttribute('aria-expanded')) === 'false')
            await toggle.click()
          const group = nav.getByRole('button', {
            name: 'Messages',
            exact: true,
          })
          if ((await group.getAttribute('aria-expanded')) !== 'true')
            await group.click()
        } else await nav.hover()
        await nav.getByRole('button', { name, exact: true }).click()
        if (width >= 1024) await page.mouse.move(width - 10, 500)
        await page.waitForTimeout(500)
      }
      await selectDestination('Selling')
      if (width < 1024)
        await page
          .getByText('Phase1C listing 7', { exact: true })
          .first()
          .waitFor()
      else
        await page.locator(`[data-message-history="${selling.id}"]`).waitFor()
      await selectDestination('Buying')
      if (width < 1024) {
        assert.equal(
          await page
            .locator('[data-mobile-message-screen="list"]')
            .getAttribute('aria-hidden'),
          'false',
          'Destination return must show neutral list, not consume the old entry again'
        )
        await page.getByRole('button').filter({ hasText: outgoing }).click()
      }
      await history.getByText(outgoing, { exact: true }).waitFor()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await history
        .getByText(outgoing, { exact: true })
        .waitFor({ timeout: 30000 })
      assert.equal(
        (await api(buyer, `/api/messages/conversations/${c.id}`)).unreadCount,
        0
      )
      assert.equal(
        await history.getByText(outgoing, { exact: true }).count(),
        1
      )
      assert.equal(
        errors.length,
        0,
        'No browser runtime errors: ' + errors.join('; ')
      )
      console.log(
        `PASS ${width}: real TEXT send/refresh/read, keyboard/IME, slide/attachment gate, listing preview, containment`
      )
      await context.close()
    }
    const entryContext = await browser.newContext({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
    })
    contexts.push(entryContext)
    const entry = await entryContext.newPage()
    await entry.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) =>
      route.abort()
    )
    await entry.goto(`${base}/listings/${id(1)}`, {
      waitUntil: 'domcontentloaded',
    })
    await entry
      .getByRole('button', { name: 'Contact Seller', exact: true })
      .click()
    const auth = entry.locator('dialog[aria-labelledby="auth-title"]')
    await auth.waitFor()
    await auth
      .getByLabel('Western email', { exact: true })
      .fill('phase1c-buyer@uwo.ca')
    await auth.getByLabel('Password', { exact: true }).fill(password)
    await auth.getByRole('button', { name: 'Log in', exact: true }).click()
    await entry.waitForURL(
      `**/home?section=messages&destination=buying&conversation=${c.id}`,
      { timeout: 30000 }
    )
    await entry
      .locator(`[data-message-history="${c.id}"]`)
      .waitFor({ timeout: 30000 })
    assert.equal(
      (await api(buyer, '/api/messages/conversations?role=buying'))
        .conversations.length,
      5
    )
    console.log(
      'PASS Marketplace Contact Seller -> real sign-in -> existing find/create -> same chat'
    )
    console.log('PASS Phase 1C hosted staging HTTP and browser verification')
  } finally {
    if (browser) await browser.close()
    for (const context of contexts) await context.dispose?.().catch(() => {})
    if (seeded || process.argv.includes('--cleanup-only')) {
      const cleanup =
        await query(`begin; select set_config('storage.allow_delete_query','true',true);
        delete from public.conversations where listing_origin_id in (${listings
          .map((value) => `'${value}'`)
          .join(',')});
        delete from public.listings where id in (${listings
          .map((value) => `'${value}'`)
          .join(',')});
        delete from storage.objects where bucket_id='listing-images' and (storage.foldername(name))[1] in ('${
          users[0]
        }','${users[1]}');
        delete from auth.users where id in (${users
          .map((value) => `'${value}'`)
          .join(',')});
        select (select count(*) from auth.users where id in (${users
          .map((value) => `'${value}'`)
          .join(',')})) as users_left,
        (select count(*) from public.conversations where listing_origin_id in (${listings
          .map((value) => `'${value}'`)
          .join(',')})) as conversations_left,
        (select count(*) from public.listings where id in (${listings
          .map((value) => `'${value}'`)
          .join(',')})) as listings_left,
        (select count(*) from storage.objects where (storage.foldername(name))[1] in ('${
          users[0]
        }','${users[1]}')) as objects_left; commit;`)
      for (const value of Object.values(cleanup.rows[0]))
        assert.equal(Number(value), 0)
      console.log(
        'PASS staging fixture cleanup: users/conversations/listings/storage metadata = 0'
      )
    }
    for (const filename of fs.readdirSync(directory))
      fs.unlinkSync(path.join(directory, filename))
    fs.rmdirSync(directory)
  }
}
main().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
