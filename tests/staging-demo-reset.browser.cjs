// Read-only canonical demo baseline verification. No transaction/capability writes.
/* global fetch */
const fs = require('node:fs')
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = 'http://localhost:3000'
const staging = 'https://pcaqxezdfxofysghssyo.supabase.co'
const root = 'tests/artifacts/staging-demo'
let stage = 'staging runtime guard'
;(async () => {
  const html = await (await fetch(base + '/home')).text()
  let stagingUrl = false,
    stagingEnvironment = false
  for (const m of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const code = (await (await fetch(new URL(m[1], base))).text()).replaceAll(
      String.fromCharCode(92, 34),
      '"'
    )
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs\.supabase\.co"/.test(
        code
      )
    )
    stagingUrl ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo\.supabase\.co"/.test(
        code
      )
    stagingEnvironment ||=
      /(?:const|let|var)\s+designation\s*=\s*"staging"/.test(code)
  }
  assert(stagingUrl && stagingEnvironment)
  const state = JSON.parse(fs.readFileSync(root + '/state.json'))
  const reset = JSON.parse(
    fs.readFileSync(root + '/transaction-reset-result.json')
  )
  const creds = JSON.parse(fs.readFileSync(root + '/credentials.json'))
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const results = [],
    contexts = []
  let prohibitedWrites = 0,
    errors = 0
  try {
    for (const [identity, role, workspace] of [
      ['buyer-a', 'buying', 'purchases'],
      ['seller-b', 'selling', 'sales'],
    ]) {
      stage = identity + ' sign-in'
      const c = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
      })
      contexts.push(c)
      assert.equal(
        (
          await c.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: {
              email: creds[identity].email,
              password: creds[identity].password,
            },
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
          prohibitedWrites++
          return r.abort()
        }
        return r.continue()
      })
      stage = identity + ' Request history API'
      const history = await c.request.get(
        base +
          '/api/order-requests?conversationId=' +
          state.conversations['monitor-a']
      )
      assert.equal(history.status(), 200)
      const h = await history.json()
      assert.equal(h.requests.length, 0)
      assert.equal(h.events.length, 0)
      stage = identity + ' Orders API'
      const list = await c.request.get(
        base + '/api/orders?workspace=' + workspace
      )
      assert.equal(list.status(), 200)
      assert.equal((await list.json()).orders.length, 0)
      const deletedOrderStatuses = []
      for (const o of reset.before.orders) {
        const response = await c.request.get(base + '/api/orders/' + o.id)
        deletedOrderStatuses.push(response.status())
        assert.equal(response.status(), 403) // Existing anti-enumeration contract.
        assert.equal((await response.json()).order, undefined)
      }
      stage = identity + ' financial API'
      const financial = await c.request.get(
        base + '/api/financial-capabilities'
      )
      assert.equal(financial.status(), 200)
      const f = await financial.json()
      assert.equal(f.paymentMethod.status, 'unset')
      assert.equal(f.payoutAccount.status, 'unset')
      stage = identity + ' Monitor UI'
      const p = await c.newPage()
      p.on('pageerror', () => errors++)
      p.setDefaultTimeout(25000)
      await p.goto(base + '/home?section=messages&destination=' + role)
      await p
        .locator(
          '[data-conversation-id="' + state.conversations['monitor-a'] + '"]'
        )
        .first()
        .click()
      await p.getByRole('region', { name: 'Chat panel' }).waitFor()
      await p.getByRole('textbox', { name: 'Message', exact: true }).waitFor()
      assert.equal(await p.locator('[data-order-preview]').count(), 0)
      assert.equal(
        await p
          .getByRole('button', { name: 'View Order', exact: true })
          .count(),
        0
      )
      await p
        .getByRole('button', { name: 'Add to conversation', exact: true })
        .click()
      const send = p.getByRole('button', {
        name: 'Send Order Request',
        exact: true,
      })
      if (identity === 'seller-b') {
        await send.waitFor()
        await send.click()
        await p
          .getByRole('heading', { name: 'Set up payouts first', exact: true })
          .waitFor()
      } else assert.equal(await send.count(), 0)
      stage = identity + ' Settings UI'
      await p.goto(base + '/home?section=settings&focus=payments-payouts')
      for (const cap of ['payment_method', 'payout_account'])
        await p
          .locator('[data-financial-capability="' + cap + '"]')
          .getByText('Unset', { exact: true })
          .waitFor()
      stage = identity + ' Orders UI'
      await p.goto(base + '/home?section=orders&destination=' + workspace)
      await p.getByText('No ' + workspace + ' yet.', { exact: true }).waitFor()
      results.push({
        identity,
        settings: ['Unset', 'Unset'],
        workspace,
        orders: 0,
        monitorRequests: 0,
        monitorEvents: 0,
        sellerRequestPath:
          identity === 'seller-b'
            ? 'payout setup required; no write'
            : 'not offered',
        deletedOrderStatuses,
      })
    }
    assert.equal(prohibitedWrites, 0)
    assert.equal(errors, 0)
    fs.writeFileSync(
      root + '/transaction-reset-browser.json',
      JSON.stringify({ results, prohibitedWrites, errors }, null, 2)
    )
    console.log(
      JSON.stringify({ passed: true, results, prohibitedWrites, errors })
    )
  } finally {
    for (const c of contexts) await c.close()
    await browser.close()
  }
})().catch(() => {
  console.error(
    'Baseline verification failed at ' +
      stage +
      '; sensitive diagnostics withheld'
  )
  process.exitCode = 1
})
