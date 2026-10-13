// Real staging sessions/history. Transport gates exercise loading; no transaction writes.
/* global fetch */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
let stage = 'runtime guard'
const base = 'http://localhost:3000'
const staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
;(async () => {
  // Confirm the served build before any authenticated request is made.
  const html = await (await fetch(base + '/home')).text()
  let stagingUrl = false
  let stagingEnvironment = false
  for (const match of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const code = (await (await fetch(new URL(match[1], base))).text())
      .replaceAll(String.fromCharCode(92, 34), '"')
      .replaceAll(String.fromCharCode(92, 110), '\n')
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs\.supabase\.co"/.test(
        code
      ),
      'Production runtime prohibited'
    )
    stagingUrl ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo\.supabase\.co"/.test(
        code
      )
    stagingEnvironment ||=
      /(?:const|let|var)\s+designation\s*=\s*"staging"/.test(code)
  }
  assert(stagingUrl && stagingEnvironment, 'Confirmed staging runtime required')

  const creds = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const results = []
  let errors = 0
  let forbiddenWrites = 0
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' })
    const login = await context.request.post(base + '/api/auth/sign-in', {
      headers: { Origin: base, 'X-Marketplace-Request': '1' },
      data: {
        email: creds['buyer-a'].email,
        password: creds['buyer-a'].password,
      },
    })
    assert.equal(login.status(), 200)
    await context.route('**/*', (route) => {
      const r = route.request(),
        u = new URL(r.url())
      if (![base, staging].includes(u.origin)) return route.abort()
      if (r.method() === 'POST' && u.pathname.endsWith('/read'))
        return route.fulfill({
          json: {
            conversation_id: u.pathname.split('/')[4],
            last_read_sequence: r.postDataJSON().throughSequence,
            unread_count: 0,
          },
        })
      if (
        !['GET', 'HEAD'].includes(r.method()) &&
        u.pathname !== '/api/messages/realtime-session'
      ) {
        forbiddenWrites++
        return route.abort()
      }
      return route.continue()
    })
    const scenarios = [
      [
        'buying',
        '/home?section=messages&destination=buying',
        '/api/messages/conversations',
        'Loading conversations',
      ],
      [
        'selling',
        '/home?section=messages&destination=selling',
        '/api/messages/conversations',
        'Loading conversations',
      ],
      [
        'purchases',
        '/home?section=orders&destination=purchases',
        '/api/orders',
        'Loading orders',
      ],
      [
        'sales',
        '/home?section=orders&destination=sales',
        '/api/orders',
        'Loading orders',
      ],
      [
        'favorites',
        '/home?section=favorites',
        '/api/favorites',
        'Loading listings',
      ],
      [
        'my-listings',
        '/home?section=my-listings',
        '/api/listings',
        'Loading listings',
      ],
      ['overview', '/home', '/api/profile/account', null],
    ]
    for (const width of process.env.LOADING_NESTED_ONLY
      ? []
      : process.env.LOADING_WIDTHS
      ? process.env.LOADING_WIDTHS.split(',').map(Number)
      : [1280, 1536, 390, 430]) {
      for (const [name, url, endpoint, label] of process.env
        .LOADING_SUPPLEMENT_ONLY
        ? []
        : scenarios) {
        stage = name + ' skeleton ' + width
        const page = await context.newPage()
        await page.setViewportSize({ width, height: 900 })
        page.on('pageerror', () => errors++)
        let release
        const gate = new Promise((resolve) => (release = resolve))
        let holding = true
        await page.route('**' + endpoint + '*', async (route) => {
          if (new URL(route.request().url()).pathname !== endpoint)
            return route.continue()
          if (holding)
            await Promise.race([
              gate,
              new Promise((resolve) => setTimeout(resolve, 65000)),
            ])
          return route.continue()
        })
        await page.goto(base + url, { waitUntil: 'domcontentloaded' })
        const skeleton = label
          ? page.getByRole('status', { name: label, exact: true })
          : page.locator('[data-profile-account][aria-busy="true"]')
        await skeleton.waitFor({ timeout: 60000 })
        assert((await skeleton.locator('[data-slot="skeleton"]').count()) > 0)
        assert.equal(
          await page
            .getByText(
              /No (orders|purchases|sales|conversations|favorites) yet\./
            )
            .count(),
          0
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        if (width === 390) {
          await page.emulateMedia({ reducedMotion: 'reduce' })
          const node = skeleton.locator('[data-slot="skeleton"]').first()
          assert.equal(
            await node.evaluate(
              (n) => getComputedStyle(n, '::after').animationName
            ),
            'none'
          )
        }
        await page.screenshot({
          path:
            'tests/artifacts/order-accept/loading-' +
            name +
            '-' +
            width +
            '.png',
          fullPage: true,
        })
        holding = false
        release()
        await skeleton.waitFor({ state: 'hidden', timeout: 60000 })
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        if (name === 'buying') {
          const monitor = '08c740e5-48b4-40a1-926e-922eef639bc8'
          await page
            .locator('[data-conversation-id="' + monitor + '"]')
            .first()
            .click()
          await page.locator('[data-message-id]').first().waitFor()
          let end
          const wait = new Promise((r) => (end = r))
          await page.route('**/api/order-requests?**', async (route) => {
            await wait
            return route.continue()
          })
          await page.evaluate(
            (id) =>
              window.dispatchEvent(
                new CustomEvent('marketplace-request-invalidated', {
                  detail: { conversationId: id },
                })
              ),
            monitor
          )
          await page.waitForTimeout(100)
          assert(await page.locator('[data-message-id]').first().isVisible())
          assert.equal(
            await page
              .getByRole('status', {
                name: 'Loading conversations',
                exact: true,
              })
              .count(),
            0
          )
          assert.equal(
            await page
              .getByRole('status', {
                name: 'Loading Order Requests',
                exact: true,
              })
              .count(),
            0
          )
          end()
        }
        results.push({
          name,
          width,
          skeleton: true,
          reducedMotion: width === 390,
          overflow: false,
        })
        await page.close()
      }
    }
    // Failure and successful empty are separate, deterministic transport projections.
    for (const [kind, status, json] of [
      ['error', 503, { message: 'Unavailable' }],
      ['empty', 200, { orders: [], serverTime: new Date().toISOString() }],
    ]) {
      stage = kind + ' Orders state'
      const page = await context.newPage()
      page.on('pageerror', () => errors++)
      await page.route('**/api/orders?**', (route) =>
        route.fulfill({ status, json })
      )
      await page.goto(base + '/home?section=orders&destination=purchases')
      if (kind === 'error')
        await page.getByRole('alert').waitFor({ timeout: 30000 })
      else
        await page
          .getByText('No purchases yet.', { exact: true })
          .waitFor({ timeout: 30000 })
      await page
        .getByRole('status', { name: 'Loading orders', exact: true })
        .waitFor({ state: 'hidden', timeout: 30000 })
      await page.close()
    }
    for (const width of process.env.LOADING_NESTED_ONLY
      ? []
      : process.env.LOADING_WIDTHS
      ? process.env.LOADING_WIDTHS.split(',').map(Number)
      : [1280, 1536, 390, 430]) {
      for (const kind of process.env.LOADING_MARKET_ONLY
        ? ['market']
        : ['settings', 'create', 'market', 'analytics']) {
        stage = kind + ' supplementary ' + width
        console.log(stage)
        const p = await context.newPage()
        await p.setViewportSize({ width, height: 900 })
        p.on('pageerror', () => errors++)
        let release
        const gate = new Promise((r) => (release = r))
        let holding = true
        const endpoint =
          kind === 'settings'
            ? '/api/profile/account'
            : kind === 'create'
            ? '/api/auth/session'
            : kind === 'analytics'
            ? '/api/profile/categories'
            : '/api/listings'
        let marketEmpty = kind === 'market'
        await p.route('**' + endpoint + '*', async (r) => {
          if (new URL(r.request().url()).pathname !== endpoint)
            return r.continue()
          if (marketEmpty) {
            return r.fulfill({ json: [] })
          }
          if (holding)
            await Promise.race([
              gate,
              new Promise((resolve) => setTimeout(resolve, 65000)),
            ])
          return r.continue()
        })
        await p.goto(
          base +
            (kind === 'market'
              ? '/listings'
              : kind === 'create'
              ? '/home?section=create-listing'
              : kind === 'analytics'
              ? '/home'
              : '/home?section=messages&destination=buying'),
          { waitUntil: 'domcontentloaded' }
        )
        if (kind === 'settings') {
          const nav = p.locator(
            width < 768
              ? '[data-smooth-dropdown]'
              : '[data-slot="sidebar-body"]'
          )
          if (width < 768)
            await nav
              .getByRole('button', {
                name: 'Open Home navigation',
                exact: true,
              })
              .click({ timeout: 60000 })
          else await nav.hover()
          await nav
            .getByRole(width < 768 ? 'button' : 'link', {
              name: 'Settings',
              exact: true,
            })
            .click()
        }
        results.push({ name: kind, width, skeleton: true, overflow: false })
        await p.close()
      }
    }

    stage = 'Nested Messages first load and cached return'
    const nested = await context.newPage()
    await nested.setViewportSize({ width: 1280, height: 900 })
    nested.on('pageerror', () => errors++)
    let nestedRelease
    const nestedGate = new Promise((r) => (nestedRelease = r))
    await nested.route('**/api/messages/conversations?**', async (r) => {
      if (new URL(r.request().url()).searchParams.get('role') === 'selling')
        await nestedGate
      return r.continue()
    })
    await nested.goto(base + '/home?section=messages&destination=buying')
    await nested
      .locator('[data-conversation-id="08c740e5-48b4-40a1-926e-922eef639bc8"]')
      .first()
      .waitFor({ timeout: 60000 })
    const nav = nested.locator('[data-slot="sidebar-body"]')
    await nav.hover()
    await nav.getByRole('button', { name: 'Selling', exact: true }).click()
    await nested
      .getByRole('status', { name: 'Loading conversations', exact: true })
      .waitFor()
    assert.equal(
      await nested
        .locator(
          '[data-conversation-id="08c740e5-48b4-40a1-926e-922eef639bc8"]'
        )
        .count(),
      0
    )
    nestedRelease()
    await nested.getByText('No conversations yet.', { exact: true }).waitFor()
    await nav.hover()
    await nav.getByRole('button', { name: 'Buying', exact: true }).click()
    await nested
      .locator('[data-conversation-id="08c740e5-48b4-40a1-926e-922eef639bc8"]')
      .first()
      .waitFor()
    assert.equal(
      await nested
        .getByRole('status', { name: 'Loading conversations', exact: true })
        .count(),
      0
    )
    await nested.mouse.move(1200, 500)
    await nested.waitForTimeout(250) // Existing sidebar hover-close animation, test only.
    let bodyRelease
    const bodyGate = new Promise((r) => (bodyRelease = r))
    await nested.route(
      '**/api/messages/conversations/82314c7a-97db-41c5-90a4-789f41103ab1/messages',
      async (r) => {
        await bodyGate
        return r.continue()
      }
    )
    await nested
      .locator('[data-conversation-id="82314c7a-97db-41c5-90a4-789f41103ab1"]')
      .first()
      .click()
    await nested
      .getByRole('status', { name: 'Loading message history', exact: true })
      .waitFor()
    bodyRelease()
    await nested.locator('[data-message-id]').first().waitFor()

    stage = 'Messages authoritative background history retained'
    let bgRelease
    const bgGate = new Promise((r) => (bgRelease = r))
    await nested.route(
      '**/api/messages/conversations/82314c7a-97db-41c5-90a4-789f41103ab1/messages',
      async (r) => {
        await bgGate
        return r.continue()
      }
    )
    const historyRequested = nested.waitForRequest((r) =>
      r.url().includes('/82314c7a-97db-41c5-90a4-789f41103ab1/messages')
    )
    await nested.evaluate(() => window.dispatchEvent(new Event('focus')))
    await historyRequested
    assert(await nested.locator('[data-message-id]').first().isVisible())
    assert.equal(
      await nested
        .getByRole('status', { name: 'Loading message history', exact: true })
        .count(),
      0
    )
    const historyReturned = nested.waitForResponse((r) =>
      r.url().includes('/82314c7a-97db-41c5-90a4-789f41103ab1/messages')
    )
    bgRelease()
    await historyReturned
    await nested.close()
    assert.equal(errors, 0)
    assert.equal(forbiddenWrites, 0)
    fs.writeFileSync(
      'tests/artifacts/order-accept/' +
        (process.env.LOADING_NESTED_ONLY
          ? 'formal-background-result.json'
          : 'formal-loading-result.json'),
      JSON.stringify(
        {
          results,
          errors,
          forbiddenWrites,

          passed: true,
        },
        null,
        2
      )
    )
    console.log(
      JSON.stringify({
        checks: results.length,
        widths: [390, 430, 1280, 1536],
        errors,
        forbiddenWrites,

        passed: true,
      })
    )
    await context.close()
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error('FAIL ' + stage + ': ' + e.message)
  process.exitCode = 1
})
