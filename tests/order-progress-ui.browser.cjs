// Real staging sessions/history. Transport gates exercise loading; no transaction writes.
/* global fetch, structuredClone, document, innerWidth */
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
        base + '/api/orders/b289dd54-b226-4e1f-9f65-6e530a885911'
      )
      assert.equal(response.status(), 200)
      const historical = (await response.json()).order
      assert(
        historical,
        'Existing historical Order required; never create a fixture'
      )
      const role = identity === 'buyer-a' ? 'buyer' : 'seller'
      for (const [name, fulfillment, payment, money, lifecycle] of [
        ['pickup-pending', 'pickup', 'pending', 'finalized', 'open'],
        ['pickup-paid', 'pickup', 'paid', 'finalized', 'open'],
        ['meet-pending', 'meet', 'pending', 'finalized', 'open'],
        ['meet-paid', 'meet', 'paid', 'finalized', 'open'],
        ['shipping-pending', 'shipping', 'pending', 'finalized', 'open'],
        ['shipping-paid', 'shipping', 'paid', 'finalized', 'open'],
        ['shipping-quote', 'shipping', 'pending', 'shipping_pending', 'open'],
        // Terminal outcomes are covered by order-terminal.browser.cjs; no active Stepper.
      ]) {
        const order = structuredClone(historical)
        Object.assign(order, {
          lifecycle,
          paymentStatus: payment,
          moneyStatus: money,
          payoutStatus: 'not_eligible',
          holdsListing: money === 'finalized' && lifecycle === 'open',
          paymentPaidAt: payment === 'paid' ? new Date().toISOString() : null,
          reservationExpiresAt:
            money === 'finalized'
              ? new Date(Date.now() + 25 * 60000).toISOString()
              : null,
        })
        order.snapshot.draft.fulfillment = fulfillment
        if (money === 'shipping_pending')
          order.shippingAmount = order.serviceFee = order.totalAmount = null
        const title =
          lifecycle === 'expired'
            ? 'Reservation expired'
            : money === 'shipping_pending'
            ? role === 'buyer'
              ? 'Waiting for shipping quote'
              : 'Set shipping cost'
            : payment === 'pending'
            ? role === 'buyer'
              ? 'Complete payment'
              : 'Waiting for buyer payment'
            : fulfillment === 'shipping'
            ? role === 'buyer'
              ? 'Waiting for seller to ship'
              : 'Ship the item'
            : role === 'buyer'
            ? 'Meet the seller'
            : 'Meet the buyer'
        const steps =
          fulfillment === 'shipping'
            ? role === 'buyer'
              ? [
                  'Order accepted',
                  'Payment',
                  'Shipped',
                  'Received',
                  'Marketplace Protection',
                  'Completed',
                ]
              : [
                  'Order accepted',
                  'Buyer payment',
                  'Ship item',
                  'Delivered / Protection',
                  'Payout',
                ]
            : role === 'buyer'
            ? [
                'Order accepted',
                'Payment',
                'Meet & inspect',
                'Handoff confirmed',
                'Marketplace Protection',
                'Completed',
              ]
            : [
                'Order accepted',
                'Buyer payment',
                'Meet buyer / handoff',
                'Handoff confirmed',
                'Payout on hold',
                'Payout',
              ]
        if (money === 'shipping_pending')
          steps.splice(
            1,
            0,
            role === 'buyer' ? 'Shipping quote' : 'Set shipping cost'
          )
        await c.route('**/api/orders?**', (r) =>
          r.fulfill({
            json: { orders: [order], serverTime: new Date().toISOString() },
          })
        )
        for (const width of [390, 430, 1280, 1536]) {
          stage = role + ' ' + name + ' ' + width
          const p = await c.newPage()
          p.on('pageerror', () => errors++)
          await p.setViewportSize({ width, height: 1000 })
          await p.goto(
            base +
              '/home?section=orders&destination=' +
              mode +
              '&order=' +
              order.id,
            { waitUntil: 'domcontentloaded' }
          )
          const detail = p.locator('[data-formal-order="' + order.id + '"]')
          await detail.waitFor({ timeout: 60000 })
          assert.equal(await detail.getAttribute('data-order-role'), role)
          const next = detail.getByRole('region', {
            name: 'Next Step',
            exact: true,
          })
          await next
            .getByRole('heading', { name: title, exact: true })
            .waitFor()
          assert.deepEqual(
            await detail.locator('[data-slot="stepper"] li').allTextContents(),
            steps.map(
              (label, i) =>
                (i < (payment === 'paid' ? 2 : 1) ? '' : String(i + 1)) + label
            )
          )
          const active = detail.locator('[aria-current="step"]')
          assert.equal(
            await active.count(),
            lifecycle === 'expired' || payment === 'paid' ? 0 : 1
          )
          if (lifecycle !== 'expired' && payment !== 'paid')
            assert.equal(
              await active.getAttribute('aria-label'),
              steps[payment === 'paid' ? 2 : 1] + ': Current'
            )
          assert.equal(
            await detail.locator('[data-done]').count(),
            payment === 'paid' ? 2 : 1
          )
          assert.equal(
            await next.locator('[data-order-countdown]').count(),
            payment === 'pending' &&
              money === 'finalized' &&
              lifecycle === 'open'
              ? 1
              : 0
          )
          if (payment === 'paid' && fulfillment !== 'shipping') {
            assert(
              (await next.innerText()).includes(order.snapshot.draft.location)
            )
            assert((await next.innerText()).includes('Schedule'))
          }
          assert.equal(await next.getByRole('button').count(), 0)
          await detail
            .getByRole('tab', { name: 'Payment', exact: true })
            .click()
          const panel = detail.locator('[data-payment-role="' + role + '"]')
          await panel.waitFor()
          await panel
            .getByText(role === 'buyer' ? 'Payment method' : 'Payout account', {
              exact: true,
            })
            .waitFor()
          assert.equal(
            await panel
              .getByText(
                role === 'buyer' ? 'Payout account' : 'Payment method',
                { exact: true }
              )
              .count(),
            0
          )
          if (
            role === 'seller' ||
            payment === 'paid' ||
            money === 'shipping_pending' ||
            lifecycle === 'expired'
          )
            assert.equal(
              await panel
                .getByRole('button', {
                  name: 'Simulate successful payment',
                  exact: true,
                })
                .count(),
              0
            )
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          )
          assert(
            await detail
              .locator('[data-slot="stepper"]')
              .evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
          )
          await p.screenshot({
            path:
              'tests/artifacts/order-financial/phase-f-' +
              role +
              '-' +
              name +
              '-' +
              width +
              '.png',
            fullPage: true,
          })
          results.push({ role, name, width, steps: steps.length, passed: true })
          await p.close()
        }
        await c.unroute('**/api/orders?**')
        console.log('PASS ' + role + ' ' + name + ' all four widths')
      }
      await c.close()
    }
    assert.equal(errors, 0)
    assert.equal(writes, 0)
    fs.writeFileSync(
      'tests/artifacts/order-financial/phase-f-results.json',
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
