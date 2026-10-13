// Real staging history and sessions; no Request writes. Expired-only presentation uses an explicitly intercepted API response.
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
  const fixture = fs.existsSync(
    'tests/artifacts/order-accept/manual-active-fixture.json'
  )
    ? JSON.parse(
        fs.readFileSync(
          'tests/artifacts/order-accept/manual-active-fixture.json'
        )
      )
    : null
  const result = { sessions: [], acceptCalls: 0 }
  try {
    for (const [key, role] of [
      ['seller-a', 'selling'],
      ['seller-b', 'selling'],
      ['buyer-a', 'buying'],
    ]) {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
      })
      await context.route('**/*', (route) => {
        const origin = new URL(route.request().url()).origin
        return [base, staging].includes(origin) ? route.continue() : route.abort()
      })
      await context.route('**/api/order-requests/*/accept', (route) => {
        result.acceptCalls++
        return route.abort()
      })
      await context.route('**/api/messages/conversations/*/read', (route) =>
        route.fulfill({
          json: {
            conversation_id: route.request().url().split('/')[6],
            last_read_sequence: route.request().postDataJSON().throughSequence,
            unread_count: 0,
          },
        })
      )
      const login = await context.request.post(base + '/api/auth/sign-in', {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: { email: creds[key].email, password: creds[key].password },
      })
      assert.equal(login.status(), 200)
      const response = await context.request.get(
        base + '/api/messages/conversations?role=' + role
      )
      assert.equal(response.status(), 200)
      const api = (await response.json()).conversations
      assert.equal(new Set(api.map((c) => c.id)).size, api.length)
      const page = await context.newPage()
      let errors = 0
      page.on('pageerror', () => errors++)
      stage = 'audit navigation ' + key
      await page.goto(base + '/home?section=messages&destination=' + role)
      await page
        .locator('[data-conversation-id]')
        .first()
        .waitFor({ timeout: 60000 })
      const rows = await page
        .locator('[data-conversation-id]')
        .evaluateAll((nodes) =>
          nodes.map((n) => ({
            id: n.dataset.conversationId,
            label: n.getAttribute('aria-label') || n.textContent,
          }))
        )
      assert.equal(rows.length, api.length)
      assert.equal(new Set(rows.map((c) => c.id)).size, rows.length)
      const entry = {
        role: key,
        api: api.map((c) => ({
          id: c.id,
          person: c.person.name,
          title: c.listing.title,
        })),
        rows,
      }
      if (key === 'seller-a') {
        assert.equal(
          api.filter((c) => c.person.name === 'Demo_buyer_b').length,
          1
        )
        assert.equal(
          rows.filter((c) => c.label.startsWith('Demo_buyer_b:')).length,
          1
        )
        entry.buyerBRows = 1
      }
      if (fixture && ['seller-b', 'buyer-a'].includes(key)) {
        stage = 'manual Active visibility ' + key
        await page
          .locator('[data-conversation-id="' + fixture.conversation_id + '"]')
          .first()
          .click()
        const card = page.locator(
          '[data-order-preview="' +
            fixture.id +
            '"][data-request-status="active"]'
        )
        await card.waitFor({ timeout: 30000 })
        const h = await (
          await context.request.get(
            base +
              '/api/order-requests?conversationId=' +
              fixture.conversation_id
          )
        ).json()
        assert(h.eligibleRequestIds.includes(fixture.id))
        await card.locator('button').first().click()
        const dialog = page.getByRole('dialog', {
          name: 'Order Request',
          exact: true,
        })
        await dialog.waitFor()
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Accept', exact: true })
            .count(),
          key === 'buyer-a' ? 1 : 0
        )
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await page.reload()
        await page
          .locator('[data-conversation-id="' + fixture.conversation_id + '"]')
          .first()
          .click({ timeout: 60000 })
        await card.waitFor({ timeout: 30000 })
        const refreshed = await (
          await context.request.get(
            base +
              '/api/order-requests?conversationId=' +
              fixture.conversation_id
          )
        ).json()
        assert.deepEqual(refreshed.requests, h.requests)
        entry.manualActive = true
        entry.acceptVisible = key === 'buyer-a'
        entry.refresh = true
        const workspace = key === 'buyer-a' ? 'purchases' : 'sales'
        const orders = await (
          await context.request.get(base + '/api/orders?workspace=' + workspace)
        ).json()
        assert(!orders.orders.some((o) => o.requestId === fixture.id))
        entry.manualOrderCount = 0
        await page.screenshot({
          path: 'tests/artifacts/order-accept/manual-' + key + '.png',
          fullPage: true,
        })
      }
      if (['seller-a', 'buyer-a'].includes(key)) {
        const workspace = key === 'buyer-a' ? 'purchases' : 'sales'
        const orders = await (
          await context.request.get(base + '/api/orders?workspace=' + workspace)
        ).json()
        assert(
          orders.orders.some(
            (o) => o.id === 'a5cda495-975a-4bd8-b15b-75f749a68285'
          )
        )
        const nike = api.find((c) => c.listing.title.includes('Nike'))
        const h = await (
          await context.request.get(
            base + '/api/order-requests?conversationId=' + nike.id
          )
        ).json()
        assert(
          h.requests.some(
            (r) =>
              r.id === '491172d7-ec03-4de5-ac1a-11587409fa3f' &&
              r.status === 'accepted'
          )
        )
        entry.nikePreserved = true
      }
      assert.equal(errors, 0)
      result.sessions.push(entry)
      await context.close()
    }
    assert.equal(result.acceptCalls, 0)
    result.passed = true
    fs.writeFileSync(
      'tests/artifacts/order-accept/manual-browser-result.json',
      JSON.stringify(result, null, 2)
    )
    console.log(JSON.stringify(result))
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error('FAIL ' + stage + ': ' + e.message)
  process.exitCode = 1
})
