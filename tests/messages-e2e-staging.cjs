/* eslint-disable no-inner-declarations -- Workflow helpers share the isolated staging fixture session. */
/* global document, Navigator, innerWidth, CompositionEvent, KeyboardEvent, getComputedStyle */
// Opt-in real HTTP + GoTrue + PostgreSQL verification on the pinned hosted staging.
// Auth fixtures use admin setup; listings, real files and messages use the UI/API.
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
const id = (n) => 'f1d00000-0000-4000-8000-' + String(n).padStart(12, '0')
const users = [id(101), id(102), id(103)]
const listings = []
const password = crypto.randomBytes(24).toString('hex') + 'Aa!9'
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-phase1d-'))
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
    email: `phase1d-${name}@uwo.ca`,
    password,
  })
  const session = await api(context, '/api/auth/session')
  assert.equal(
    session.seller.id,
    users[['seller', 'buyer', 'outsider'].indexOf(name)]
  )
}

const results = []
async function observeDtoQueries(context, config) {
  // Run the unchanged Pages handler with a genuine test browser's session. The
  // transport records only URL paths, never cookies, keys, headers or payloads.
  const ts = require('typescript')
  const cache = new Map()
  function load(file) {
    const full = path.resolve(file)
    if (cache.has(full)) return cache.get(full)
    const module = { exports: {} }
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
    new Function('require', 'module', 'exports', code)(
      (name) =>
        name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
      module,
      module.exports
    )
    cache.set(full, module.exports)
    return module.exports
  }
  process.env.NEXT_PUBLIC_SUPABASE_URL = config.NEXT_PUBLIC_SUPABASE_URL
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    config.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const transport = global.fetch
  const paths = []
  global.fetch = async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input.url || String(input)
    )
    assert.equal(url.host, `${ref}.supabase.co`)
    paths.push(url.pathname)
    return transport(input, init)
  }
  try {
    const headers = {}
    const response = {
      statusCode: 200,
      setHeader(key, value) {
        headers[key] = value
      },
      getHeader(key) {
        return headers[key]
      },
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    const cookie = (await context.cookies())
      .map((item) => `${item.name}=${item.value}`)
      .join('; ')
    const handler = load(
      'pages/api/messages/conversations/[[...segments]].ts'
    ).default
    const start = Date.now()
    await handler(
      {
        method: 'GET',
        query: { role: 'buying' },
        headers: { host: new URL(base).host, cookie },
      },
      response
    )
    assert.equal(response.statusCode, 200)
    assert.equal(response.body.conversations.length, 5)
    const rest = paths.filter((value) => value.startsWith('/rest/v1/'))
    assert.equal(rest.length, 21)
    return {
      queryRequests: rest.length,
      authRequests: paths.filter((value) => value.startsWith('/auth/')).length,
      milliseconds: Date.now() - start,
    }
  } finally {
    global.fetch = transport
  }
}
const output = 'tests/artifacts/messages-phase1d'
function passed(name, detail = {}) {
  results.push({ scenario: name, result: 'PASS', ...detail })
  console.log(
    'PASS ' +
      name +
      (Object.keys(detail).length ? ' ' + JSON.stringify(detail) : '')
  )
}
async function waitUntil(check, label) {
  for (let n = 0; n < 100; n++) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 150))
  }
  throw new Error('Timed out: ' + label)
}
const messagesBase = '/api/messages/conversations'
const chat = (page) =>
  page.getByRole('region', { name: 'Chat panel', exact: true })
const history = (page) =>
  page.getByRole('region', { name: 'Chat messages', exact: true })
const textbox = (page) =>
  chat(page).getByRole('textbox', { name: 'Message', exact: true })
async function openChat(page, conversation, role = 'buying') {
  await page.goto(
    `${base}/home?section=messages&destination=${role}&conversation=${conversation.id}`,
    { waitUntil: 'domcontentloaded' }
  )
  await page
    .locator(`[data-message-history="${conversation.id}"]`)
    .waitFor({ timeout: 60000 })
  await page.waitForTimeout(400)
}
async function sendUi(page, text) {
  const previous = await history(page).locator('[data-message-id]').count()
  await chat(page).locator('[data-chat-send][data-state=idle]').waitFor()
  await textbox(page).fill(text)
  await textbox(page).press('Enter')
  assert.equal(await textbox(page).inputValue(), '')
  await history(page)
    .getByText(text.trim(), { exact: true })
    .waitFor({ timeout: 30000 })
  assert.equal(
    await history(page).locator('[data-message-id]').count(),
    previous + 1
  )
}
async function nav(page, group, child) {
  const mobile = page.viewportSize().width < 1024
  const surface = page.locator(
    mobile ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
  )
  if (mobile) {
    const toggle = surface.getByRole('button', {
      name: 'Open Home navigation',
      exact: true,
    })
    if ((await toggle.getAttribute('aria-expanded')) === 'false')
      await toggle.click()
    const parent = surface.getByRole('button', { name: group, exact: true })
    if (!child || (await parent.getAttribute('aria-expanded')) !== 'true')
      await parent.click()
  } else {
    await surface.hover()
    await surface.getByRole('link', { name: group, exact: true }).click()
  }
  if (child)
    await surface.getByRole('button', { name: child, exact: true }).click()
  if (!mobile) await page.mouse.move(page.viewportSize().width - 10, 450)
  await page.waitForTimeout(450)
}
async function rowOrder(page, expected) {
  const mobile = page.viewportSize().width < 1024
  if (!mobile) {
    const rail = page.locator('[data-conversation-id]')
    assert.deepEqual(
      await rail.evaluateAll((rows) =>
        rows.map((row) => row.dataset.conversationId)
      ),
      expected.slice(0, 3)
    )
    await page
      .getByRole('button', { name: 'Expand conversations', exact: true })
      .click()
  }
  await page.waitForTimeout(400)
  const rows = page.locator('[data-conversation-list] [data-conversation-id]')
  // The list's source is the same ID model as the compact rail.
  const actual = await page
    .locator('[data-conversation-id]')
    .evaluateAll((elements) =>
      elements
        .filter((el) => el.getBoundingClientRect().width > 0)
        .map((el) => el.dataset.conversationId)
    )
  assert.deepEqual(actual, expected)
  assert.equal((await rows.count()) || actual.length, expected.length)
}

async function main() {
  fs.mkdirSync(output, { recursive: true })
  const projects = await cli(['projects', 'list'])
  const linked = projects.projects.filter((project) => project.linked)
  assert.equal(linked.length, 1)
  assert.equal(linked[0].ref, ref)
  assert.equal(linked[0].name, 'western-marketplace-staging')
  const config = Object.fromEntries(
    fs
      .readFileSync('.env.staging.local', 'utf8')
      .trim()
      .split(/\r?\n/)
      .map((line) => {
        const i = line.indexOf('=')
        return [line.slice(0, i), line.slice(i + 1)]
      })
  )
  assert.equal(config.NEXT_PUBLIC_SUPABASE_URL, `https://${ref}.supabase.co`)
  const anonymous = await request.newContext()
  await api(anonymous, messagesBase + '?role=buying', undefined, 401)
  // Current Messages guard returns 503 before networking for any non-staging runtime.
  passed(
    'CLI link, dedicated config and running staging API confirmed before writes'
  )
  const setup = `begin;
    do $$ begin if exists(select 1 from auth.users where id in (${users
      .map((value) => `'${value}'`)
      .join(
        ','
      )})) then raise exception 'Phase1D fixture collision'; end if; end $$;
    insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at,raw_app_meta_data,raw_user_meta_data,encrypted_password,confirmation_token,recovery_token,email_change_token_new,email_change,email_change_token_current,reauthentication_token)
    values ${users
      .map(
        (value, n) =>
          `('${value}','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase1d-${
            ['seller', 'buyer', 'outsider'][n]
          }@uwo.ca',now(),now(),now(),'{"provider":"email","providers":["email"]}','{"username":"${
            n === 0
              ? 'Phase1D_Seller_Long1'
              : 'Phase1D_' + ['Seller', 'Buyer', 'Outsider'][n]
          }"}',extensions.crypt('${password}',extensions.gen_salt('bf')),'','','','','','')`
      )
      .join(',')};
    insert into auth.identities(user_id,provider_id,provider,identity_data,created_at,updated_at)
    select id,id::text,'email',jsonb_build_object('sub',id,'email',email,'email_verified',true),now(),now() from auth.users where id in (${users
      .map((value) => `'${value}'`)
      .join(',')}); commit;`
  let seeded = false
  let browser
  const contexts = []
  try {
    await query(setup)
    seeded = true
    browser = await chromium.launch({
      executablePath: process.env.BROWSER_EXECUTABLE,
      headless: true,
      args: ['--enable-unsafe-swiftshader'],
    })
    const pageErrors = []
    async function newContext(name, width = 1280) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      contexts.push(context)
      await login(context.request, name)
      const page = await context.newPage()
      page.on('pageerror', (error) => pageErrors.push(error.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      return { context, page }
    }
    const a = await newContext('seller'),
      b = await newContext('buyer'),
      c = await newContext('outsider')
    passed('three independent real Western Auth cookie sessions')
    async function createUi(n) {
      await a.page.goto(base + '/home?section=create-listing', {
        waitUntil: 'domcontentloaded',
      })
      const form = a.page.getByRole('form', {
        name: 'Create listing',
        exact: true,
      })
      await form.waitFor({ timeout: 60000 })
      const title =
        n === 2
          ? 'Phase1D second listing ' + 'long-title-'.repeat(8)
          : `Phase1D acceptance listing ${n}`
      await form.locator('[name=title]').fill(title)
      await form.locator('[name=price]').fill('45')
      for (const [name, label] of [
        ['Category', 'Home & Dorm'],
        ['Subcategory', 'Furniture'],
        ['Condition', 'Good'],
        ['Place', 'On campus'],
      ]) {
        await form.getByRole('combobox', { name, exact: true }).click()
        const option = form.getByRole('option', { name: label, exact: true })
        await option.scrollIntoViewIfNeeded()
        await option.click()
      }
      await form
        .locator('[name=description]')
        .fill('Phase1D disposable staging listing. Real UI publication.')
      await form.locator('input[type=file]').setInputFiles({
        name: `phase1d-${n}.jpg`,
        mimeType: 'image/jpeg',
        buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
      })
      const published = a.page.waitForResponse(
        (response) =>
          /\/api\/listings\/[^/]+\/finalize$/.test(
            new URL(response.url()).pathname
          ) && response.request().method() === 'POST'
      )
      await form.getByRole('button', { name: 'Create', exact: true }).click()
      const response = await published
      assert.equal(response.status(), 200)
      const listing = await response.json()
      listings.push(listing.id)
      assert.equal(listing.seller.id, users[0])
      assert.equal(listing.title, title)
      assert(listing.publishedAt)
      assert.equal(listing.photoUrls.length, 1)
      await a.page
        .getByRole('dialog', { name: 'Listing created', exact: true })
        .waitFor({ timeout: 30000 })
      await a.page.screenshot({ path: `${output}/listing-${n}-published.png` })
      passed(`Seller UI create/upload/publish listing ${n}`)
      return listing
    }
    const live = []
    for (let n = 1; n <= 5; n++) live.push(await createUi(n))
    async function contact(page, listing) {
      await page.goto(`${base}/listings/${listing.id}`, {
        waitUntil: 'domcontentloaded',
      })
      await page
        .getByRole('button', { name: 'Contact Seller', exact: true })
        .click()
      await page.waitForURL(
        /\/home\?section=messages&destination=buying&conversation=/
      )
      const uuid = new URL(page.url()).searchParams.get('conversation')
      await page.locator(`[data-message-history="${uuid}"]`).waitFor()
      const result = await api(
        page.context().request,
        `${messagesBase}/${uuid}`
      )
      assert.equal(result.listing.id, listing.id)
      assert.equal(result.listing.title, listing.title)
      assert.equal(result.person.name, 'Phase1D_Seller_Long1')
      return result
    }
    const conversations = []
    for (const listing of live)
      conversations.push(await contact(b.page, listing))
    const primary = conversations[0]
    assert.equal((await contact(b.page, live[0])).id, primary.id)
    assert.equal(
      (await api(b.context.request, messagesBase + '?role=buying'))
        .conversations.length,
      5
    )
    assert.notEqual(conversations[1].id, primary.id)
    const outsiderOwn = await contact(c.page, live[4])
    assert.notEqual(outsiderOwn.id, conversations[4].id)
    passed(
      'real listing Contact Seller, same conversation on repeat, separate listing/buyer identity'
    )
    await openChat(a.page, primary, 'selling')
    assert.equal(await history(a.page).locator('[data-message-id]').count(), 0)
    await openChat(b.page, primary)
    await sendUi(b.page, 'Hello seller')
    assert.equal(
      await history(a.page).getByText('Hello seller', { exact: true }).count(),
      0,
      'No Realtime delivery is expected'
    )
    const sellerBefore = await api(
      a.context.request,
      `${messagesBase}/${primary.id}`
    )
    assert.equal(sellerBefore.role, 'selling')
    assert.equal(sellerBefore.unreadCount, 1)
    assert.equal(
      (await api(b.context.request, messagesBase + '?role=selling'))
        .conversations.length,
      0
    )
    assert.equal(
      (await api(a.context.request, messagesBase + '?role=buying'))
        .conversations.length,
      0
    )
    await a.page.goto(base + '/home?section=messages&destination=selling', {
      waitUntil: 'domcontentloaded',
    })
    await history(a.page).getByText('Hello seller', { exact: true }).waitFor()
    await waitUntil(
      async () =>
        (
          await api(a.context.request, `${messagesBase}/${primary.id}`)
        ).unreadCount === 0,
      'seller read acknowledgment'
    )
    assert.equal(
      (await api(a.context.request, `${messagesBase}/${primary.id}`))
        .activityAt,
      sellerBefore.activityAt
    )
    await sendUi(a.page, 'Hi buyer')
    assert.equal(
      (await api(b.context.request, `${messagesBase}/${primary.id}`))
        .unreadCount,
      1
    )
    await b.page.reload({ waitUntil: 'domcontentloaded' })
    await history(b.page).getByText('Hi buyer', { exact: true }).waitFor()
    await waitUntil(
      async () =>
        (
          await api(b.context.request, `${messagesBase}/${primary.id}`)
        ).unreadCount === 0,
      'buyer read acknowledgment'
    )
    assert.deepEqual(
      (
        await api(b.context.request, `${messagesBase}/${primary.id}/messages`)
      ).messages.map((item) => [item.sequence, item.content]),
      [
        [1, 'Hello seller'],
        [2, 'Hi buyer'],
      ]
    )
    const blue = await history(b.page)
      .getByText('Hello seller', { exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    const purple = await history(b.page)
      .getByText('Hi buyer', { exact: true })
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    assert.equal(blue, 'rgb(0, 122, 255)')
    assert.equal(purple, 'rgb(119, 84, 151)')
    passed(
      'two-user TEXT, role mapping, no realtime, own exclusion, canonical history, read-only activity, bubble colors'
    )
    for (const index of [3, 1, 4, 2, 0])
      await api(
        b.context.request,
        `${messagesBase}/${conversations[index].id}/messages`,
        {
          type: 'TEXT',
          content: `Activity ${index}`,
          clientMessageId: crypto.randomUUID(),
        }
      )
    const canonical = (
      await api(b.context.request, messagesBase + '?role=buying')
    ).conversations.map((item) => item.id)
    assert.deepEqual(
      canonical,
      [0, 2, 4, 1, 3].map((index) => conversations[index].id)
    )
    // Real RPC activity ordering is checked above. Use legitimate empty conversations
    // with the same explicit created_at only in the administrative tie observation.
    const tieItems = [conversations[3], conversations[4]]
    const originals = await Promise.all(
      tieItems.map((item) =>
        api(b.context.request, `${messagesBase}/${item.id}`)
      )
    )
    await query(
      `update public.conversations set last_message_at=now() where id in ('${tieItems[0].id}','${tieItems[1].id}');`
    )
    const tied = (await api(b.context.request, messagesBase + '?role=buying'))
      .conversations
    assert.equal(tied[0].activityAt, tied[1].activityAt)
    assert.deepEqual(
      tied.slice(0, 2).map((item) => item.id),
      tieItems.map((item) => item.id).sort()
    )
    await b.page.goto(base + '/home?section=messages&destination=buying', {
      waitUntil: 'domcontentloaded',
    })
    await waitUntil(
      async () =>
        (await b.page.locator('[data-conversation-id]').count()) === 3,
      'tie rail'
    )
    await rowOrder(
      b.page,
      tied.map((item) => item.id)
    )
    await query(
      `update public.conversations set last_message_at=case id ${originals
        .map(
          (item) =>
            `when '${item.id}'::uuid then '${item.lastMessageAt}'::timestamptz`
        )
        .join(' ')} end where id in ('${tieItems[0].id}','${tieItems[1].id}');`
    )
    passed(
      'controlled fixture activity tie uses stable UUID ordering in backend and actual UI; original activity restored'
    )
    const timings = []
    for (let n = 0; n < 3; n++) {
      const start = Date.now()
      await api(b.context.request, messagesBase + '?role=buying')
      timings.push(Date.now() - start)
    }
    const measuredQueries = await observeDtoQueries(b.context, config)
    passed(
      'five-conversation canonical activity ordering and DTO HTTP observation',
      {
        listCount: 5,
        milliseconds: timings,
        observedHandler: measuredQueries,
      }
    )
    // Full HTTP cases exercise UI input boundaries without synthetic durable appends.
    await openChat(b.page, primary)
    await textbox(b.page).fill(' \n\t ')
    assert(
      await chat(b.page)
        .getByRole('button', { name: 'Send', exact: true })
        .isDisabled()
    )
    await sendUi(b.page, '  edges\ninside  ')
    await sendUi(b.page, 'x'.repeat(2000))
    await chat(b.page).locator('[data-chat-send][data-state=idle]').waitFor()
    await textbox(b.page).fill('y'.repeat(2001))
    await textbox(b.page).press('Enter')
    await chat(b.page).getByRole('alert').waitFor()
    assert.equal(await textbox(b.page).inputValue(), 'y'.repeat(2001))
    assert.equal(
      (
        await api(b.context.request, `${messagesBase}/${primary.id}/messages`)
      ).messages.filter((item) => item.content === 'y'.repeat(2001)).length,
      0
    )
    await textbox(b.page).fill('Shift')
    await textbox(b.page).press('Shift+Enter')
    await textbox(b.page).press('x')
    assert.equal(await textbox(b.page).inputValue(), 'Shift\nx')
    await chat(b.page).locator('[data-chat-send][data-state=idle]').waitFor()
    await textbox(b.page).evaluate((el) => {
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
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })
      )
      el.dispatchEvent(
        new CompositionEvent('compositionend', { bubbles: true })
      )
    })
    assert.equal(await textbox(b.page).inputValue(), 'Shift\nx')
    const beforeRapid = await api(
      b.context.request,
      `${messagesBase}/${primary.id}/messages`
    )
    await textbox(b.page).fill('Rapid guarded submission')
    await chat(b.page)
      .getByRole('button', { name: 'Send', exact: true })
      .dblclick({ force: true })
    await textbox(b.page).press('Enter')
    await textbox(b.page).fill('Fresh draft during request')
    // Ordinary automation waits for aria-disabled to clear; force a real pending click.
    await chat(b.page)
      .getByRole('button', { name: 'Send', exact: true })
      .click({ force: true })
    await history(b.page)
      .getByText('Rapid guarded submission', { exact: true })
      .waitFor()
    assert.equal(
      await textbox(b.page).inputValue(),
      'Fresh draft during request'
    )
    assert.equal(
      (await api(b.context.request, `${messagesBase}/${primary.id}/messages`))
        .messages.length,
      beforeRapid.messages.length + 1
    )
    passed(
      'UI whitespace/trim/newlines/2000/2001/Enter/Shift+Enter/IME/double-send/new-draft protection'
    )
    const endpoint = `**${messagesBase}/${primary.id}/messages`
    let firstId,
      committedId,
      attempts = 0
    const lost = 'Phase1D response lost after real commit'
    await b.page.route(endpoint, async (route) => {
      if (route.request().method() !== 'POST') return route.continue()
      attempts++
      const body = route.request().postDataJSON()
      if (attempts === 1) {
        firstId = body.clientMessageId
        const response = await route.fetch()
        assert.equal(response.status(), 200)
        committedId = (await response.json()).id
        return route.fulfill({
          status: 503,
          json: { error: 'Test lost response. Retry.' },
        })
      }
      assert.equal(body.clientMessageId, firstId)
      const response = await route.fetch()
      assert.equal((await response.json()).id, committedId)
      return route.fulfill({ response })
    })
    await chat(b.page).locator('[data-chat-send][data-state=idle]').waitFor()
    await textbox(b.page).fill(lost)
    await textbox(b.page).press('Enter')
    await chat(b.page).getByRole('alert').waitFor()
    assert.equal(await textbox(b.page).inputValue(), lost)
    await chat(b.page).locator('[data-chat-send][data-state=idle]').waitFor()
    await textbox(b.page).press('Enter')
    await textbox(b.page).fill('New draft during safe retry')
    await history(b.page).getByText(lost, { exact: true }).waitFor()
    assert.equal(
      await textbox(b.page).inputValue(),
      'New draft during safe retry'
    )
    assert.equal(
      await history(b.page).getByText(lost, { exact: true }).count(),
      1
    )
    assert.equal(
      (
        await api(b.context.request, `${messagesBase}/${primary.id}/messages`)
      ).messages.filter((item) => item.content === lost).length,
      1
    )
    await b.page.unroute(endpoint)
    passed(
      'frontend lost-response retry, same UUID/server ID, one bubble/row, new draft safe'
    )
    // Long real messages create a scroll range for exact attachment cancellation.
    for (let n = 0; n < 15; n++)
      await api(a.context.request, `${messagesBase}/${primary.id}/messages`, {
        type: 'TEXT',
        content: `Long incoming ${n} ` + 'message '.repeat(50),
        clientMessageId: crypto.randomUUID(),
      })
    await api(
      a.context.request,
      `${messagesBase}/${conversations[1].id}/messages`,
      {
        type: 'TEXT',
        content: 'Unrelated unread must remain',
        clientMessageId: crypto.randomUUID(),
      }
    )
    for (const width of [390, 430, 1280, 1536]) {
      const r = await newContext('buyer', width)
      await r.page.goto(base + '/home?section=messages&destination=buying', {
        waitUntil: 'domcontentloaded',
      })
      await waitUntil(
        async () =>
          (await r.page.locator('[data-conversation-id]').count()) >= 3,
        'conversation list visible'
      )
      const expected = (
        await api(r.context.request, messagesBase + '?role=buying')
      ).conversations.map((item) => item.id)
      await rowOrder(r.page, expected)
      await r.page.screenshot({ path: `${output}/${width}-list.png` })
      await r.page.locator(`[data-conversation-id="${primary.id}"]`).click()
      await history(r.page).getByText('Hi buyer', { exact: true }).waitFor()
      await waitUntil(
        async () =>
          (
            await api(r.context.request, `${messagesBase}/${primary.id}`)
          ).unreadCount === 0,
        'rendered boundary read'
      )
      assert.equal(
        (await api(r.context.request, `${messagesBase}/${conversations[1].id}`))
          .unreadCount,
        1
      )
      await r.page
        .locator(`[data-message-history="${primary.id}"]`)
        .evaluate((el) => {
          el.scrollTop = 100
        })
      const savedScroll = await history(r.page).evaluate((el) => el.scrollTop)
      assert(savedScroll > 0)
      const idsBefore = await history(r.page)
        .locator('[data-message-id]')
        .evaluateAll((rows) => rows.map((row) => row.dataset.messageId))
      let attachmentWrites = 0
      const observe = (req) => {
        if (
          req.method() !== 'GET' &&
          /listing-images|storage\/v1/.test(req.url())
        )
          attachmentWrites++
      }
      r.page.on('request', observe)
      await chat(r.page)
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      const panel = r.page.locator('[data-attachment-panel]')
      await panel.waitFor()
      await r.page.waitForTimeout(350)
      assert.equal(
        await r.page
          .locator(`[data-message-history="${primary.id}"] [data-message-id]`)
          .count(),
        idsBefore.length
      )
      assert(
        await panel
          .getByRole('button', { name: 'Send', exact: true })
          .isDisabled()
      )
      await panel.locator('input[type=file]').setInputFiles({
        name: 'not-uploaded.jpg',
        mimeType: 'image/jpeg',
        buffer: fs.readFileSync('public/demo/reading-chair.jpg'),
      })
      assert(
        await panel
          .getByRole('button', { name: 'Send', exact: true })
          .isDisabled()
      )
      assert.equal(attachmentWrites, 0)
      await r.page.screenshot({ path: `${output}/${width}-attachment.png` })
      await panel
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      await panel.waitFor({ state: 'detached' })
      assert.equal(
        await history(r.page).evaluate((el) => el.scrollTop),
        savedScroll,
        'Attachment cancel must retain exact history scroll position'
      )
      assert.deepEqual(
        await history(r.page)
          .locator('[data-message-id]')
          .evaluateAll((rows) => rows.map((row) => row.dataset.messageId)),
        idsBefore
      )
      const geometry = await r.page.evaluate(() => {
        const header = document
          .querySelector('[aria-label="Chat panel"] header')
          .getBoundingClientRect()
        const composer = document
          .querySelector('[aria-label="Chat panel"] textarea')
          .getBoundingClientRect()
        return {
          headerTop: header.top,
          composerBottom: composer.bottom,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }
      })
      assert(!geometry.overflow)
      await sendUi(r.page, `Responsive ${width}`)
      await r.page.reload({ waitUntil: 'domcontentloaded' })
      // Reload a list-only URL; reopen explicitly on mobile.
      if (width < 1024) {
        await r.page.locator(`[data-conversation-id="${primary.id}"]`).waitFor()
        await r.page.locator(`[data-conversation-id="${primary.id}"]`).click()
      }
      await history(r.page)
        .getByText(`Responsive ${width}`, { exact: true })
        .waitFor()
      await r.page.screenshot({ path: `${output}/${width}-chat.png` })
      if (width < 1024) {
        await r.page
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        await r.page.waitForTimeout(350)
        assert.equal(
          await r.page
            .locator('[data-messages-track]')
            .getAttribute('data-sliding'),
          'false'
        )
      }
      await nav(r.page, 'Messages', 'Selling')
      await r.page.getByText('No conversations yet.', { exact: true }).waitFor()
      await nav(r.page, 'Messages', 'Buying')
      await waitUntil(
        async () =>
          (await r.page.locator('[data-conversation-id]').count()) >= 3,
        'Buying restored'
      )
      passed(
        `${width} recent/list ordering, unread retention, slides, long content, attachment no-upload/cancel scroll, role switch, refresh`
      )
      await r.context.close()
    }
    // Failure injections change only browser transport for these requests.
    for (const kind of ['list', 'history', 'read']) {
      const target =
        kind === 'list'
          ? '**/api/messages/conversations?role=buying'
          : kind === 'history'
          ? `**${messagesBase}/${primary.id}/messages`
          : `**${messagesBase}/${primary.id}/read`
      let failed = false
      await b.page.route(target, (route) => {
        if (!failed) {
          failed = true
          return route.fulfill({
            status: 503,
            json: { error: `Test ${kind} failure; retry.` },
          })
        }
        return route.continue()
      })
      await b.page.goto(
        `${base}/home?section=messages&destination=buying&conversation=${primary.id}`,
        { waitUntil: 'domcontentloaded' }
      )
      await b.page
        .getByRole('alert')
        .filter({ hasText: `Test ${kind} failure` })
        .waitFor()
      const retryResponse = b.page.waitForResponse((response) => {
        const url = new URL(response.url())
        const wanted =
          kind === 'list'
            ? messagesBase
            : `${messagesBase}/${primary.id}/${
                kind === 'read' ? 'read' : 'messages'
              }`
        return (
          url.pathname === wanted &&
          response.status() === 200 &&
          response.request().method() === (kind === 'read' ? 'POST' : 'GET')
        )
      })
      await b.page.getByRole('button', { name: 'Retry', exact: true }).click()
      await retryResponse
      await history(b.page).getByText('Hi buyer', { exact: true }).waitFor()
      await waitUntil(
        async () =>
          (await b.page
            .getByText(`Test ${kind} failure; retry.`, { exact: false })
            .count()) === 0,
        'error recovery ' + kind
      )
      await b.page.unroute(target)
      passed(`${kind} failure feedback and recovery through Retry`)
    }
    // Switch away/reopen and leave the mounted Messages surface entirely.
    await openChat(b.page, conversations[1])
    await openChat(b.page, primary)
    await history(b.page).getByText('Hi buyer', { exact: true }).waitFor()
    await nav(b.page, 'Listings', 'Favorites')
    await nav(b.page, 'Messages', 'Buying')
    await history(b.page).getByText('Hi buyer', { exact: true }).waitFor()
    await nav(b.page, 'Settings')
    await b.page.getByRole('button', { name: 'Log out', exact: true }).click()
    const logout = b.page.getByRole('dialog', { name: 'Log out?', exact: true })
    await logout.getByRole('button', { name: 'Log out', exact: true }).click()
    await b.page.waitForURL(base + '/', { timeout: 60000 })
    await api(
      b.context.request,
      `${messagesBase}/${primary.id}/messages`,
      undefined,
      401
    )
    await b.page.getByRole('button', { name: 'Log in', exact: true }).click()
    const auth = b.page.locator('dialog[aria-labelledby="auth-title"]')
    await auth
      .getByLabel('Western email', { exact: true })
      .fill('phase1d-buyer@uwo.ca')
    await auth.getByLabel('Password', { exact: true }).fill(password)
    await auth.getByRole('button', { name: 'Log in', exact: true }).click()
    await b.page.waitForURL(base + '/listings', { timeout: 60000 })
    await openChat(b.page, primary)
    await history(b.page).getByText('Hi buyer', { exact: true }).waitFor()
    passed(
      'conversation reopen, leave/return, real UI logout/login and durable history restoration'
    )
    // Owner UI status/delete workflows preserve existing conversations.
    async function manageUi(index, action) {
      await a.page.goto(base + '/home?section=my-listings', {
        waitUntil: 'domcontentloaded',
      })
      const article = a.page.getByRole('article', {
        name: live[index].title,
        exact: true,
      })
      await article.getByRole('button', { name: action, exact: true }).click()
      const dialog = a.page.getByRole('dialog', {
        name:
          action === 'Delete'
            ? 'Delete this listing?'
            : 'Mark this listing as sold?',
        exact: true,
      })
      await dialog.getByRole('button', { name: action, exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
    }
    await manageUi(0, 'Mark as sold')
    await api(c.context.request, messagesBase, { listingId: live[0].id }, 400)
    await openChat(b.page, primary)
    await sendUi(b.page, 'Sold history still works')
    await openChat(a.page, primary, 'selling')
    await sendUi(a.page, 'Sold seller reply')
    await manageUi(1, 'Delete')
    const deleted = conversations[1]
    const snapshot = await api(
      b.context.request,
      `${messagesBase}/${deleted.id}`
    )
    assert.equal(snapshot.listing.liveId, null)
    assert.equal(snapshot.listing.title, live[1].title)
    assert.equal(snapshot.listing.price, 4500)
    assert.equal(snapshot.listing.category, 'Home & Dorm')
    await openChat(b.page, deleted)
    await sendUi(b.page, 'Deleted history still works')
    await chat(b.page)
      .getByRole('button', { name: 'View listing', exact: true })
      .click()
    const preview = b.page.getByRole('dialog', {
      name: 'Listing preview',
      exact: true,
    })
    await preview.getByText('Home & Dorm', { exact: true }).waitFor()
    await preview
      .getByText('This listing was deleted.', { exact: false })
      .waitFor()
    await b.page.screenshot({ path: `${output}/deleted-listing-snapshot.png` })
    await preview.getByRole('button', { name: 'Cancel', exact: true }).click()
    await openChat(a.page, deleted, 'selling')
    await sendUi(a.page, 'Deleted seller reply')
    passed(
      'real owner sold/delete UI, historical snapshots/preview, both participants continue TEXT, new sold entry rejected'
    )
    for (const [suffix, body] of [
      ['', undefined],
      ['/messages', undefined],
      ['/read', { throughSequence: 1 }],
      [
        '/messages',
        {
          type: 'TEXT',
          content: 'forged',
          clientMessageId: crypto.randomUUID(),
        },
      ],
    ])
      await api(
        c.context.request,
        `${messagesBase}/${primary.id}${suffix}`,
        body,
        404
      )
    await c.page.goto(
      `${base}/home?section=messages&destination=buying&conversation=${primary.id}`,
      { waitUntil: 'domcontentloaded' }
    )
    await c.page
      .getByRole('alert')
      .filter({ hasText: 'Conversation not found.' })
      .waitFor()
    assert.equal(await c.page.locator('[data-message-id]').count(), 0)
    await c.context.clearCookies()
    await api(
      c.context.request,
      `${messagesBase}/${outsiderOwn.id}/messages`,
      undefined,
      401
    )
    await api(
      c.context.request,
      `${messagesBase}/${outsiderOwn.id}/messages`,
      {
        type: 'TEXT',
        content: 'invalid session',
        clientMessageId: crypto.randomUUID(),
      },
      401
    )
    await c.page.reload({ waitUntil: 'domcontentloaded' })
    await c.page
      .getByText('Sign in with your Western account to view Messages.', {
        exact: true,
      })
      .waitFor()
    assert.equal(await c.page.locator('[data-message-id]').count(), 0)
    passed(
      'outsider detail/history/read/send/URL tampering and invalid-session reload, no data exposure'
    )
    assert.equal(
      pageErrors.length,
      0,
      'No browser errors: ' + pageErrors.join('; ')
    )
    passed('Phase 1D full acceptance')
  } catch (error) {
    results.push({
      scenario: 'acceptance run',
      result: 'FAIL',
      error: error.message,
    })
    throw error
  } finally {
    fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
    if (browser) await browser.close()
    await anonymous.dispose()
    if (seeded) {
      // Existing policy forbids deletion while listing_images still references a
      // file. Remove fixture listing rows first; keep Auth users alive for Storage.
      await query(`begin;
        delete from public.conversations where buyer_id in (${users
          .map((value) => `'${value}'`)
          .join(',')}) or seller_id in (${users
        .map((value) => `'${value}'`)
        .join(',')});
        delete from public.listings where seller_id in (${users
          .map((value) => `'${value}'`)
          .join(',')}); commit;`)
      // Physical listing files are then removed through normal owner Storage API.
      const { createClient } = require('@supabase/supabase-js')
      const objects = await query(
        `select name from storage.objects where bucket_id='listing-images' and (storage.foldername(name))[1] in (${users
          .map((value) => `'${value}'`)
          .join(',')});`
      )
      const storage = createClient(
        config.NEXT_PUBLIC_SUPABASE_URL,
        config.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        { auth: { persistSession: false } }
      )
      const signed = await storage.auth.signInWithPassword({
        email: 'phase1d-seller@uwo.ca',
        password,
      })
      assert(!signed.error)
      assert.equal(signed.data.user.id, users[0])
      const paths = objects.rows.map((row) => row.name)
      if (paths.length) {
        const removed = await storage.storage
          .from('listing-images')
          .remove(paths)
        assert(!removed.error, 'Physical fixture storage cleanup must succeed')
        assert.equal(
          removed.data.length,
          paths.length,
          'Silent RLS omission is not successful cleanup'
        )
      }
      await storage.auth.signOut()
      const cleanup = await query(`begin;
        delete from public.conversations where buyer_id in (${users
          .map((value) => `'${value}'`)
          .join(',')}) or seller_id in (${users
        .map((value) => `'${value}'`)
        .join(',')});
        delete from public.listings where seller_id in (${users
          .map((value) => `'${value}'`)
          .join(',')});
        delete from auth.users where id in (${users
          .map((value) => `'${value}'`)
          .join(',')});
        select (select count(*) from auth.users where id in (${users
          .map((value) => `'${value}'`)
          .join(',')})) as users_left,
        (select count(*) from public.messages where sender_id in (${users
          .map((value) => `'${value}'`)
          .join(',')})) as messages_left,
        (select count(*) from public.listings where seller_id in (${users
          .map((value) => `'${value}'`)
          .join(',')})) as listings_left,
        (select count(*) from storage.objects where (storage.foldername(name))[1] in (${users
          .map((value) => `'${value}'`)
          .join(',')})) as objects_left; commit;`)
      for (const value of Object.values(cleanup.rows[0]))
        assert.equal(Number(value), 0)
      passed(
        'real physical Storage cleanup + fixture Auth/listings/messages cleanup',
        cleanup.rows[0]
      )
    }
    fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2))
    for (const filename of fs.readdirSync(directory))
      fs.unlinkSync(path.join(directory, filename))
    fs.rmdirSync(directory)
  }
}
main().catch((error) => {
  console.error(error.stack)
  process.exitCode = 1
})
