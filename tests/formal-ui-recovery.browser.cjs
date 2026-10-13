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
  let errors = 0,
    writes = 0
  const results = []
  try {
    for (const identity of ['buyer-a', 'seller-b', 'seller-a']) {
      const c = await browser.newContext({ serviceWorkers: 'block' })
      const account = creds[identity]
      assert.equal(
        (
          await c.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: { email: account.email, password: account.password },
          })
        ).status(),
        200
      )
      await c.route('**/*', (r) => {
        const q = r.request(),
          u = new URL(q.url())
        if (![base, staging].includes(u.origin)) return r.abort()
        if (q.method() === 'POST' && u.pathname.endsWith('/read'))
          return r.fulfill({
            json: {
              last_read_sequence: q.postDataJSON().throughSequence,
              unread_count: 0,
            },
          })
        if (
          !['GET', 'HEAD'].includes(q.method()) &&
          u.pathname !== '/api/messages/realtime-session'
        ) {
          writes++
          return r.abort()
        }
        return r.continue()
      })
      for (const width of [390, 430, 1280, 1536]) {
        stage = identity + ' ' + width
        console.log(stage)
        const p = await c.newPage()
        await p.setViewportSize({ width, height: 900 })
        p.on('pageerror', () => errors++)
        if (identity !== 'seller-a') {
          let release
          const gate = new Promise((r) => (release = r))
          let hold = true
          await p.route('**/api/messages/conversations?**', async (r) => {
            if (hold) await gate
            return r.continue()
          })
          await p.goto(
            base +
              '/home?section=messages&destination=' +
              (identity === 'buyer-a' ? 'buying' : 'selling') +
              '&conversation=08c740e5-48b4-40a1-926e-922eef639bc8',
            { waitUntil: 'domcontentloaded' }
          )
          await p
            .getByRole('status', { name: 'Loading conversations', exact: true })
            .waitFor({ timeout: 60000 })
          hold = false
          release()
          const card = p.locator(
            '[data-order-preview="88260b5b-0851-4bf2-a100-8a5c11edd8c9"]'
          )
          await card.waitFor({ timeout: 60000 })
          assert.equal(await card.getAttribute('data-request-status'), 'active')
          await card
            .getByRole('button', { name: 'Expand Order Request', exact: true })
            .click()
          const dialog = p.getByRole('dialog', {
            name: 'Order Request',
            exact: true,
          })
          await dialog.waitFor()
          assert.equal(
            await dialog
              .getByRole('button', { name: 'Accept', exact: true })
              .count(),
            identity === 'buyer-a' ? 1 : 0
          )
          assert.equal(
            await p
              .getByText('Preview Controls / STAGING / PREVIEW ONLY', {
                exact: true,
              })
              .count(),
            0
          )
          await dialog
            .getByRole('button', { name: 'Close', exact: true })
            .click()
          await dialog.waitFor({ state: 'hidden' })
          if (identity === 'buyer-a') {
            const rows = await c.request.get(
              base + '/api/messages/conversations?role=buying'
            )
            const data = await rows.json()
            const sellerB = data.conversations.filter(
              (x) => x.person.name === 'Demo_seller_b'
            )
            assert.equal(sellerB.length, 2)
            assert.deepEqual(
              new Set(sellerB.map((x) => x.listing.title)),
              new Set(['[DEMO] 24-inch Monitor', '[DEMO] Calculus Textbook'])
            )
          }
        }
        if (identity !== 'seller-b') {
          const mode = identity === 'buyer-a' ? 'purchases' : 'sales'
          await p.goto(base + '/home?section=orders&destination=' + mode)
          const order = p.locator(
            '[data-order-list-card="a5cda495-975a-4bd8-b15b-75f749a68285"]'
          )
          await order.waitFor({ timeout: 60000 })
          await order
            .getByRole('button', { name: 'View Order', exact: true })
            .click()
          const detail = p.locator(
            '[data-formal-order="a5cda495-975a-4bd8-b15b-75f749a68285"]'
          )
          await detail.waitFor()
          assert(
            await detail
              .getByRole('heading', {
                name: 'Reservation expired',
                exact: true,
              })
              .isVisible()
          )
          assert(
            await detail
              .getByRole('tab', { name: 'Overview', exact: true })
              .isVisible()
          )
          assert.equal(await detail.locator('[data-slot="stepper"]').count(), 1)
          assert.equal(await detail.getByRole('tablist').count(), 1)
          assert.equal(
            await detail.locator('[aria-label="Payment"]').count(),
            0
          )
          assert.equal(
            await detail
              .getByRole('button', { name: 'Cancel Order', exact: true })
              .count(),
            0
          )
          let end
          const wait = new Promise((r) => (end = r))
          let waiting = true
          await p.route('**/api/orders?**', async (r) => {
            if (waiting) await wait
            return r.continue()
          })
          const pending = p.waitForRequest(
            (r) => new URL(r.url()).pathname === '/api/orders'
          )
          await p.evaluate(() =>
            window.dispatchEvent(new Event('marketplace-orders-changed'))
          )
          await pending
          assert(await detail.isVisible())
          assert.equal(
            await p
              .getByRole('status', { name: 'Loading orders', exact: true })
              .count(),
            0
          )
          waiting = false
          end()
          await detail
            .getByRole('button', {
              name:
                mode === 'purchases' ? 'Back to Purchases' : 'Back to Sales',
              exact: true,
            })
            .click()
          await order.waitFor()
        }
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        results.push({ identity, width, passed: true })
        await p.screenshot({
          path:
            'tests/artifacts/order-accept/recovery-' +
            identity +
            '-' +
            width +
            '.png',
          fullPage: true,
        })
        await p.close()
      }
      await c.close()
    }
    assert.equal(errors, 0)
    assert.equal(writes, 0)
    fs.writeFileSync(
      'tests/artifacts/order-accept/recovery-result.json',
      JSON.stringify({ results, errors, writes, passed: true }, null, 2)
    )
    console.log(
      JSON.stringify({ checks: results.length, errors, writes, passed: true })
    )
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error('FAIL ' + stage + ': ' + e.message)
  process.exitCode = 1
})
