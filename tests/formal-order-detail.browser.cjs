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
    for (const identity of ['buyer-a', 'seller-a']) {
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
      if (identity === 'seller-b') {
        await c.close()
        continue
      }
      const mode = identity === 'buyer-a' ? 'purchases' : 'sales'
      const response = await c.request.get(
        base + '/api/orders?workspace=' + mode
      )
      assert.equal(response.status(), 200)
      const orders = (await response.json()).orders
      const historical = orders.find(
        (x) => x.id === 'a5cda495-975a-4bd8-b15b-75f749a68285'
      )
      assert(
        historical,
        'Existing historical Order required; never create a fixture'
      )
      for (const width of [390, 430, 1280, 1536]) {
        stage = identity + ' ' + width
        console.log(stage)
        const p = await c.newPage()
        p.on('pageerror', () => errors++)
        p.on('console', (message) => {
          if (message.type() === 'error')
            console.log('console error: ' + message.text().slice(0, 180))
        })
        await p.setViewportSize({ width, height: 900 })
        let release
        const gate = new Promise((resolve) => {
          release = resolve
        })
        let hold = true
        await p.route('**/api/orders?**', async (route) => {
          if (hold) await gate
          return route.continue()
        })
        const exactUrl =
          base +
          '/home?section=orders&destination=' +
          mode +
          '&order=' +
          historical.id
        await p.goto(exactUrl, { waitUntil: 'domcontentloaded' })
        await p
          .getByRole('status', { name: 'Loading order details', exact: true })
          .waitFor({ timeout: 60000 })
        hold = false
        release()
        const detail = p.locator('[data-formal-order="' + historical.id + '"]')
        await detail.waitFor({ timeout: 60000 })
        assert.equal(
          await detail.getAttribute('data-order-role'),
          identity === 'buyer-a' ? 'buyer' : 'seller'
        )
        assert.equal(await detail.locator('[data-slot="stepper"]').count(), 1)
        assert.equal(await detail.locator('[data-done]').count(), 1)
        assert.equal(await detail.locator('[aria-current="step"]').count(), 0)
        assert(
          await detail
            .getByRole('status')
            .getByText('Reservation expired')
            .isVisible()
        )
        assert(
          await detail
            .getByRole('region', { name: 'Next Step', exact: true })
            .isVisible()
        )
        assert(
          await detail
            .getByRole('region', { name: 'Order overview', exact: true })
            .isVisible()
        )
        for (const [label, panel] of [
          ['Fulfillment', 'Order fulfillment'],
          ['Payment', 'Order payment'],
          ['Overview', 'Order overview'],
        ]) {
          await detail.getByRole('tab', { name: label, exact: true }).click()
          await detail
            .getByRole('region', { name: panel, exact: true })
            .waitFor()
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          )
        }
        await p.reload()
        await detail.waitFor({ timeout: 60000 })
        assert.equal(new URL(p.url()).searchParams.get('order'), historical.id)
        const request = p.waitForRequest(
          (r) => new URL(r.url()).pathname === '/api/orders'
        )
        await p.evaluate(() =>
          window.dispatchEvent(new Event('marketplace-orders-changed'))
        )
        await request
        assert(await detail.isVisible())
        assert.equal(
          await p
            .getByRole('status', { name: 'Loading order details', exact: true })
            .count(),
          0
        )
        await detail
          .getByRole('button', {
            name: 'Back to ' + (mode === 'sales' ? 'Sales' : 'Purchases'),
            exact: true,
          })
          .click()
        const card = p.locator('[data-order-list-card="' + historical.id + '"]')
        await card.waitFor()
        await card
          .getByRole('button', { name: 'View Order', exact: true })
          .click()
        await detail.waitFor()
        assert.equal(new URL(p.url()).searchParams.get('order'), historical.id)
        // Read-only Accepted Request -> exact persisted Order. Never click Accept.
        await p.goto(
          base +
            '/home?section=messages&destination=' +
            (identity === 'buyer-a' ? 'buying' : 'selling') +
            '&conversation=' +
            historical.conversationId
        )
        const rich = p.locator(
          '[data-order-preview="' + historical.requestId + '"]'
        )
        await rich.waitFor({ timeout: 60000 })
        await rich
          .getByRole('button', { name: 'Expand Order Request', exact: true })
          .click()
        const dialog = p.getByRole('dialog', {
          name: 'Order Request',
          exact: true,
        })
        await dialog
          .getByRole('button', { name: 'View Order', exact: true })
          .waitFor({ timeout: 60000 })
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Accept', exact: true })
            .count(),
          0
        )
        await dialog
          .getByRole('button', { name: 'View Order', exact: true })
          .click()
        await detail.waitFor({ timeout: 60000 })
        assert.equal(new URL(p.url()).searchParams.get('destination'), mode)
        assert.equal(new URL(p.url()).searchParams.get('order'), historical.id)
        assert.equal(
          await p
            .getByText('Preview Controls / STAGING / PREVIEW ONLY', {
              exact: true,
            })
            .count(),
          0
        )
        const open = orders.find((x) => x.lifecycle === 'open')
        let countdown = 'no existing open Order'
        if (open) {
          await p.goto(
            base +
              '/home?section=orders&destination=' +
              mode +
              '&order=' +
              open.id
          )
          const current = p.locator('[data-formal-order="' + open.id + '"]')
          await current.waitFor({ timeout: 60000 })
          const next = current.getByRole('region', {
            name: 'Next Step',
            exact: true,
          })
          if (open.moneyStatus === 'shipping_pending') {
            assert(
              await next
                .getByRole('heading', {
                  name:
                    identity === 'buyer-a'
                      ? 'Waiting for shipping quote'
                      : 'Set shipping cost',
                  exact: true,
                })
                .isVisible()
            )
            assert.equal(
              await current.locator('[data-order-countdown]').count(),
              0
            )
            countdown = 'shipping pending: no countdown'
          } else if (
            !(await next
              .getByRole('heading', {
                name: 'Reservation expired',
                exact: true,
              })
              .count())
          ) {
            assert(
              await next
                .getByRole('heading', {
                  name:
                    identity === 'buyer-a'
                      ? 'Complete payment'
                      : 'Waiting for buyer payment',
                  exact: true,
                })
                .isVisible()
            )
            assert((await next.innerText()).includes('reservation remaining'))
            countdown = 'authoritative countdown visible'
          } else countdown = 'existing reservation elapsed'
        }
        // Presentation-only response projections. No fixture or backend state is created.
        for (const projectedState of ['reserved', 'shipping_pending']) {
          const projected = structuredClone(historical)
          projected.lifecycle = 'open'
          projected.holdsListing = projectedState === 'reserved'
          projected.moneyStatus =
            projectedState === 'reserved' ? 'finalized' : 'shipping_pending'
          const serverNow = Date.now() + 120000
          projected.reservationExpiresAt =
            projectedState === 'reserved'
              ? new Date(serverNow + 25 * 60000).toISOString()
              : null
          if (projectedState === 'shipping_pending') {
            projected.snapshot.draft.fulfillment = 'shipping'
            projected.snapshot.draft.shippingCost = 'arranged'
            projected.shippingAmount =
              projected.serviceFee =
              projected.totalAmount =
                null
          }
          await p.route('**/api/orders?**', (r) =>
            r.fulfill({
              json: {
                orders: [projected],
                serverTime: new Date(serverNow).toISOString(),
              },
            })
          )
          await p.goto(exactUrl)
          await detail.waitFor({ timeout: 60000 })
          const next = detail.getByRole('region', {
            name: 'Next Step',
            exact: true,
          })
          if (projectedState === 'reserved') {
            assert(
              await next
                .getByRole('heading', {
                  name:
                    identity === 'buyer-a'
                      ? 'Complete payment'
                      : 'Waiting for buyer payment',
                  exact: true,
                })
                .isVisible()
            )
            const timer = detail.locator('[data-order-countdown="reservation"]')
            assert.match(await timer.innerText(), /(?:24:|25:)/)
            assert(
              (await next.innerText()).includes(
                identity === 'buyer-a'
                  ? 'Reserved for you'
                  : 'Buyer payment pending'
              )
            )
            if (identity === 'seller-a')
              assert(
                (await next.innerText()).includes(
                  'Do not hand over the item until payment is confirmed.'
                )
              )
            const deadline = projected.reservationExpiresAt
            await p.reload()
            await detail.waitFor({ timeout: 60000 })
            assert.match(await timer.innerText(), /(?:24:|25:)/)
            assert.equal(projected.reservationExpiresAt, deadline)
          } else {
            assert(
              await next
                .getByRole('heading', {
                  name:
                    identity === 'buyer-a'
                      ? 'Waiting for shipping quote'
                      : 'Set shipping cost',
                  exact: true,
                })
                .isVisible()
            )
            assert.equal(
              await detail.locator('[data-order-countdown]').count(),
              0
            )
            await detail
              .getByRole('tab', { name: 'Payment', exact: true })
              .click()
            await detail
              .getByRole('region', { name: 'Order payment', exact: true })
              .waitFor()
            assert.equal(
              await detail.getByText('Total', { exact: true }).count(),
              0
            )
          }
          assert.equal(
            await detail
              .getByRole('button', {
                // Account Settings navigation is not a payment/fulfillment mutation.
                name: /^(Pay(?:\s|$)|Confirm Shipped|Confirm Received|Cancel Order)/,
              })
              .count(),
            0
          )
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          )
        }
        results.push({
          identity,
          width,
          countdown,
          responseProjectedStates: ['reserved', 'shipping_pending'],
          exactNavigation: true,
          refresh: true,
          skeleton: true,
          passed: true,
        })
        await p.unroute('**/api/orders?**')
        await p.goto(exactUrl)
        await detail.waitFor({ timeout: 60000 })
        await p.screenshot({
          path:
            'tests/artifacts/order-accept/parity-' +
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
      'tests/artifacts/order-accept/parity-result.json',
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
