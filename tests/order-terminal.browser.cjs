// Existing Nike is read-only; all alternative outcomes are browser DTO projections.
/* global fetch, document, innerWidth, getComputedStyle, structuredClone */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const ref = 'pcaqxezdfxofysghssyo'
const base = 'http://localhost:3000'
const staging = `https://${ref}.supabase.co`
const nike = 'b289dd54-b226-4e1f-9f65-6e530a885911'
const root = path.resolve('tests/artifacts/order-terminal')
const focused = process.env.REQUEST_STATUS_ONLY === '1'
const listOnly = process.env.ORDER_LIST_ONLY === '1'
assert.equal(spawnSync('git', ['check-ignore', root + '/probe']).status, 0)
fs.mkdirSync(root, { recursive: true })
function readNike() {
  const file = path.join(root, 'readonly.sql')
  fs.writeFileSync(
    file,
    `begin read only;select o.lifecycle_status,o.payment_status,r.status request_status,l.status listing_status,md5(to_jsonb(o)::text||to_jsonb(r)::text||to_jsonb(l)::text) fingerprint,to_jsonb(r) request,(select jsonb_agg(h.id order by h.id) from public.orders h where h.listing_id=o.listing_id and h.buyer_id=o.buyer_id and h.seller_id=o.seller_id and h.lifecycle_status in ('expired','cancelled')) history_ids from public.orders o join public.order_requests r on r.id=o.request_id join public.listings l on l.id=o.listing_id where o.id='${nike}';rollback;`
  )
  try {
    const result = spawnSync(
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
      { encoding: 'utf8', windowsHide: true }
    )
    assert.equal(result.status, 0, 'Read-only staging audit failed')
    return JSON.parse(result.stdout.slice(result.stdout.indexOf('{'))).rows[0]
  } finally {
    fs.unlinkSync(file)
  }
}
;(async () => {
  const env = fs.readFileSync('.env.staging.local', 'utf8')
  assert(/APP_ENV=staging/.test(env) && env.includes(staging))
  const html = await (await fetch(base + '/home')).text()
  let bound = false
  for (const m of html.matchAll(/src="([^" ]+\.js[^" ]*)"/g)) {
    const js = (await (await fetch(new URL(m[1], base))).text()).replaceAll(
      String.fromCharCode(92, 34),
      '"'
    )
    assert(
      !/(?:const|let|var)\s+url\s*=\s*"https:\/\/yzvchumzyonegujucyqs/.test(js)
    )
    bound ||=
      /(?:const|let|var)\s+url\s*=\s*"https:\/\/pcaqxezdfxofysghssyo/.test(js)
  }
  assert(bound, 'Served staging runtime required')
  const before = readNike()
  assert.equal(before.lifecycle_status, 'expired')
  assert.equal(before.request_status, 'accepted')
  const creds = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json')
  )
  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.BROWSER_EXECUTABLE,
  })
  const results = []
  const runtimeDiagnostics = []
  let writes = 0,
    errors = 0,
    lastPage,
    stage = 'start'
  try {
    for (const role of ['buyer', 'seller']) {
      const c = await browser.newContext({ serviceWorkers: 'block' })
      const account = creds[role + '-a']
      assert.equal(
        (
          await c.request.post(base + '/api/auth/sign-in', {
            headers: { Origin: base, 'X-Marketplace-Request': '1' },
            data: { email: account.email, password: account.password },
          })
        ).status(),
        200
      )
      const actual = await c.request.get(base + '/api/orders/' + nike)
      assert.equal(actual.status(), 200)
      const original = (await actual.json()).order
      assert.equal(original.lifecycle, 'expired')
      assert(original.expiredAt && original.acceptedAt)
      const request = {
        id: original.requestId,
        conversationId: original.conversationId,
        status: 'accepted',
        createdAt: before.request.created_at,
        snapshot: original.snapshot,
      }
      const mode = role === 'buyer' ? 'purchases' : 'sales'
      const realHistory = []
      for (const id of before.history_ids) {
        const response = await c.request.get(base + '/api/orders/' + id)
        assert.equal(response.status(), 200)
        realHistory.push((await response.json()).order)
      }
      let listOrders = null
      let listDelay = 0
      let listReadStarted = () => {}
      let order = original,
        activeRequest = false
      await c.route('**/*', async (r) => {
        const q = r.request(),
          u = new URL(q.url())
        if (![base, staging].includes(u.origin)) return r.abort()
        if (u.pathname.startsWith('/api/orders')) {
          if (listDelay && u.pathname === '/api/orders') {
            listReadStarted()
            await new Promise((resolve) => setTimeout(resolve, listDelay))
          }
          return r.fulfill({
            json:
              u.pathname === '/api/orders'
                ? {
                    orders: listOrders || (activeRequest ? [] : [order]),
                    serverTime: new Date().toISOString(),
                  }
                : {
                    order:
                      listOrders?.find(
                        (o) => o.id === u.pathname.split('/').pop()
                      ) || order,
                    serverTime: new Date().toISOString(),
                  },
          })
        }
        if (u.pathname === '/api/order-requests')
          return r.fulfill({
            json: {
              requests: [
                { ...request, status: activeRequest ? 'active' : 'accepted' },
              ],
              events: [],
              eligibleRequestIds: activeRequest ? [request.id] : [],
              sellerId: original.sellerId,
              buyerId: original.buyerId,
              serverTime: new Date().toISOString(),
            },
          })
        if (u.pathname === '/api/financial-capabilities')
          return r.fulfill({
            json: {
              paymentMethod: { status: 'unset' },
              payoutAccount: { status: 'ready' },
              serverTime: new Date().toISOString(),
            },
          })
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
      for (const width of listOnly
        ? []
        : focused
        ? [1280]
        : [1280, 1536, 390, 430]) {
        for (const kind of focused
          ? ['expired', 'cancelled', 'pending']
          : ['expired', 'cancelled', 'pending', 'paid', 'shipping-pending']) {
          stage = `${role} ${kind} ${width}`
          order = structuredClone(original)
          if (kind !== 'expired')
            Object.assign(order, {
              lifecycle: kind === 'cancelled' ? 'cancelled' : 'open',
              expiredAt: null,
              holdsListing: kind !== 'cancelled' && kind !== 'shipping-pending',
              paymentStatus: kind === 'paid' ? 'paid' : 'pending',
              paymentPaidAt: kind === 'paid' ? new Date().toISOString() : null,
              reservationExpiresAt: new Date(
                Date.now() + 1800000
              ).toISOString(),
            })
          if (kind === 'cancelled')
            order.cancellation = {
              at: new Date().toISOString(),
              byRole: 'buyer',
              reasonCode: 'other',
              reason: 'Other',
              note: 'Terminal presentation fixture',
            }
          if (kind === 'shipping-pending') {
            order.moneyStatus = 'shipping_pending'
            order.shippingAmount = order.serviceFee = order.totalAmount = null
            order.reservationExpiresAt = null
            order.snapshot.draft.fulfillment = 'shipping'
            order.snapshot.draft.shippingCost = 'arranged'
          }
          const p = await c.newPage()
          lastPage = p
          p.setDefaultTimeout(20000)
          p.on('pageerror', (error) => {
            errors++
            runtimeDiagnostics.push(error.message)
          })
          await p.setViewportSize({ width, height: 1000 })
          await p.goto(
            base + `/home?section=orders&destination=${mode}&order=${nike}`,
            { waitUntil: 'domcontentloaded' }
          )
          const detail = p.locator('[data-formal-order]')
          await detail.waitFor({ timeout: 60000 })
          assert.equal(await detail.getAttribute('data-order-role'), role)
          const terminal = ['expired', 'cancelled'].includes(kind)
          assert.equal(
            await detail
              .getByRole('region', { name: 'Next Step', exact: true })
              .count(),
            terminal ? 0 : 1
          )
          assert.equal(
            await detail
              .getByRole('region', { name: 'Order Progress', exact: true })
              .count(),
            terminal ? 0 : 1
          )
          if (terminal) {
            await detail
              .getByRole('region', { name: 'Transaction status' })
              .getByText('Accepted', { exact: true })
              .waitFor()
            assert.equal(
              await detail.locator('[data-order-countdown]').count(),
              0
            )
            assert.equal(
              await detail
                .getByRole('button', { name: 'Cancel order', exact: true })
                .count(),
              0
            )
          }
          await detail
            .getByRole('tab', { name: 'Payment', exact: true })
            .click()
          const payment = detail.getByRole('region', {
            name: 'Order payment',
            exact: true,
          })
          await payment
            .getByText(
              terminal
                ? 'No payment was completed.'
                : role === 'buyer'
                ? 'Payment method'
                : 'Payout account',
              { exact: true }
            )
            .waitFor()
          if (terminal) {
            assert.equal(await payment.getByRole('button').count(), 0)
            assert.equal(
              await payment.locator('[data-payment-role]').count(),
              0
            )
            assert.equal(
              await payment.locator('[data-order-countdown]').count(),
              0
            )
          }
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth + 1
            )
          )
          if (terminal) {
            await p.screenshot({
              path: path.join(root, `${kind}-${role}-${width}.png`),
              fullPage: true,
            })
            await detail
              .getByRole('button', {
                name: `Back to ${mode === 'purchases' ? 'Purchases' : 'Sales'}`,
                exact: true,
              })
              .click()
            const card = p.locator('[data-order-list-card]')
            await card.waitFor()
            assert.equal(
              await card.getAttribute('data-order-terminal'),
              kind === 'expired' ? 'Expired' : 'Cancelled'
            )
            assert.equal(
              await card.evaluate((el) => getComputedStyle(el).backgroundColor),
              'rgb(36, 34, 39)'
            )
            await card
              .getByRole('button', { name: 'View details', exact: true })
              .click()
            await p.locator('[data-formal-order]').waitFor()
          }
          if (terminal || focused) {
            await p.goto(
              base +
                `/home?section=messages&destination=${
                  role === 'buyer' ? 'buying' : 'selling'
                }`
            )
            await p
              .locator(`[data-conversation-id="${original.conversationId}"]`)
              .first()
              .click()
            const req = p.locator(`[data-order-preview="${request.id}"]`)
            await req
              .getByText(terminal ? 'Request accepted' : 'Accepted', {
                exact: true,
              })
              .waitFor()
            await req
              .getByText(
                kind === 'expired'
                  ? 'Order expired'
                  : kind === 'cancelled'
                  ? 'Order cancelled'
                  : 'Accepted',
                { exact: true }
              )
              .waitFor()
            assert.equal(
              await req.getAttribute('data-request-status'),
              'accepted'
            )
            assert.equal(
              await req.getAttribute('data-request-tone'),
              kind === 'expired'
                ? 'muted'
                : kind === 'cancelled'
                ? 'destructive'
                : 'success'
            )
            const badge = req.locator('> div > span').first()
            assert.equal(
              await badge.evaluate(
                (el) => getComputedStyle(el).backgroundColor
              ),
              kind === 'expired'
                ? 'rgb(64, 57, 71)'
                : kind === 'cancelled'
                ? 'rgb(70, 52, 59)'
                : 'rgb(41, 67, 52)'
            )
            await req.screenshot({
              path: path.join(root, `request-${kind}-${role}-${width}.png`),
            })
            await req
              .getByRole('button', {
                name: 'Expand Order Request',
                exact: true,
              })
              .click()
            const dialog = p.getByRole('dialog', {
              name: 'Order Request',
              exact: true,
            })
            await dialog.getByText('Accepted', { exact: true }).waitFor()
            const layout = await dialog.evaluate((el) => {
              const overflow = [...el.querySelectorAll('*')].filter((node) => {
                const style = getComputedStyle(node)
                return (
                  ['auto', 'scroll'].includes(style.overflowY) &&
                  node.scrollHeight > node.clientHeight + 2
                )
              })
              const footer = el.querySelector('button')?.getBoundingClientRect()
              return {
                scrolls: overflow.length,
                horizontal: el.scrollWidth > el.clientWidth + 1,
                footerVisible: footer && footer.bottom <= innerHeight,
              }
            })
            assert(!layout.horizontal)
            assert(layout.footerVisible)
            assert(
              layout.scrolls <= (width >= 1280 ? 0 : 1),
              JSON.stringify(layout)
            )
            assert.equal(
              await dialog.getByText('Cancelled by', { exact: true }).count(),
              0
            )
            assert.equal(
              await dialog.getByText('Cancelled at', { exact: true }).count(),
              0
            )
            await dialog.screenshot({
              path: path.join(root, `terms-${kind}-${role}-${width}.png`),
            })
            if (terminal) {
              await dialog.getByText('Order outcome', { exact: true }).waitFor()
              await dialog
                .getByText(kind === 'expired' ? 'Expired' : 'Cancelled', {
                  exact: true,
                })
                .waitFor()
            }
            assert.equal(
              await dialog
                .getByRole('button', { name: 'Accept', exact: true })
                .count(),
              0
            )
            await dialog
              .getByRole('button', {
                name: terminal ? 'View details' : 'View Order',
                exact: true,
              })
              .click()
            await p.locator('[data-formal-order]').waitFor()
          }
          results.push({
            role,
            width,
            kind,
            passed: true,
            realNike: kind === 'expired',
          })
          await p.close()
        }
      }
      if (role === 'buyer' && !listOnly) {
        activeRequest = true
        const p = await c.newPage()
        lastPage = p
        await p.goto(base + '/home?section=messages&destination=buying')
        await p
          .locator(`[data-conversation-id="${original.conversationId}"]`)
          .first()
          .click()
        await p
          .locator(`[data-order-preview="${request.id}"]`)
          .getByRole('button', { name: 'Expand Order Request', exact: true })
          .click()
        await p
          .getByRole('dialog', { name: 'Order Request', exact: true })
          .getByRole('button', { name: 'Accept', exact: true })
          .waitFor()
        await p.close()
      }
      activeRequest = false
      for (const width of [390, 430, 1280, 1536]) {
        listOrders = [
          ...realHistory,
          ...['pending', 'paid', 'shipping'].map((kind, index) => ({
            ...original,
            id: `00000000-0000-4000-8000-00000000000${index}`,
            lifecycle: 'open',
            paymentStatus: kind === 'paid' ? 'paid' : 'pending',
            moneyStatus: kind === 'shipping' ? 'shipping_pending' : 'finalized',
            holdsListing: kind !== 'shipping',
            cancellation: null,
            expiredAt: null,
            reservationExpiresAt:
              kind === 'shipping'
                ? null
                : new Date(Date.now() + 900000).toISOString(),
          })),
        ]
        const p = await c.newPage()
        lastPage = p
        await p.setViewportSize({ width, height: 900 })
        p.on('pageerror', () => errors++)
        await p.goto(base + `/home?section=orders&destination=${mode}`)
        await p.locator('[data-order-list-card]').first().waitFor()
        assert.equal(await p.locator('[data-order-list-card]').count(), 3)
        const group = p.getByRole('group', { name: 'Order list view' })
        assert.equal(
          await group
            .getByRole('button', { name: 'Active', exact: true })
            .getAttribute('aria-pressed'),
          'true'
        )
        await group
          .getByRole('button', { name: 'History', exact: true })
          .focus()
        await p.keyboard.press('Space')
        await p.locator(`[data-order-list-card="${nike}"]`).waitFor()
        assert.equal(
          await p.locator('[data-order-list-card]').count(),
          realHistory.length
        )
        assert.equal(
          await p
            .locator('[data-order-list-card]:not([data-order-terminal])')
            .count(),
          0
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth + 1
          )
        )
        await p.screenshot({
          path: path.join(root, `history-${role}-${width}.png`),
        })
        const expected = [...realHistory].sort(
          (a, b) =>
            Date.parse(b.cancellation?.at || b.expiredAt || b.createdAt) -
              Date.parse(a.cancellation?.at || a.expiredAt || a.createdAt) ||
            a.id.localeCompare(b.id)
        )
        assert.deepEqual(
          await p
            .locator('[data-order-list-card]')
            .evaluateAll((nodes) => nodes.map((n) => n.dataset.orderListCard)),
          expected.map((o) => o.id)
        )
        for (const value of realHistory) {
          await p
            .locator(`[data-order-list-card="${value.id}"]`)
            .getByRole('button', { name: 'View details', exact: true })
            .click()
          await p.locator(`[data-formal-order="${value.id}"]`).waitFor()
          assert.equal(new URL(p.url()).searchParams.get('order'), value.id)
          await p
            .getByRole('button', {
              name: `Back to ${mode === 'purchases' ? 'Purchases' : 'Sales'}`,
              exact: true,
            })
            .click()
          await p.locator(`[data-order-list-card="${value.id}"]`).waitFor()
          assert.equal(
            new URL(p.url()).searchParams.get('orderView'),
            'history'
          )
        }
        await group.getByRole('button', { name: 'Active', exact: true }).click()
        const pending = listOrders.find((o) => o.id.endsWith('000'))
        await p.locator(`[data-order-list-card="${pending.id}"]`).waitFor()
        listOrders = listOrders.map((o) =>
          o.id === pending.id
            ? {
                ...o,
                lifecycle: 'expired',
                expiredAt: new Date().toISOString(),
                holdsListing: false,
              }
            : o
        )
        listDelay = 1000
        const requested = new Promise((resolve) => {
          listReadStarted = resolve
        })
        await p.evaluate(() =>
          window.dispatchEvent(new Event('marketplace-orders-changed'))
        )
        await requested
        assert.equal(
          await p
            .getByRole('status', { name: 'Loading orders', exact: true })
            .count(),
          0
        )
        assert.equal(await p.locator('[data-order-list-card]').count(), 3)
        await p
          .locator(`[data-order-list-card="${pending.id}"]`)
          .waitFor({ state: 'detached' })
        listDelay = 0
        assert.equal(await p.locator('[data-order-list-card]').count(), 2)
        await group
          .getByRole('button', { name: 'History', exact: true })
          .click()
        await p.locator(`[data-order-list-card="${pending.id}"]`).waitFor()
        listOrders = []
        await p.evaluate(() =>
          window.dispatchEvent(new Event('marketplace-orders-changed'))
        )
        await p.getByText('No order history yet.', { exact: true }).waitFor()
        await group.getByRole('button', { name: 'Active', exact: true }).click()
        await p.getByText('No active orders', { exact: true }).waitFor()
        results.push({
          role,
          width,
          kind: 'active-history-navigation',
          realHistoryIds: realHistory.map((o) => o.id),
          passed: true,
        })
        await p.close()
      }
      listOrders = null
      activeRequest = true
      for (const width of [390, 430, 1280, 1536]) {
        const p = await c.newPage()
        lastPage = p
        await p.setViewportSize({ width, height: 900 })
        p.on('pageerror', () => errors++)
        await p.goto(
          base +
            `/home?section=messages&destination=${
              role === 'buyer' ? 'buying' : 'selling'
            }`
        )
        await p
          .locator(`[data-conversation-id="${original.conversationId}"]`)
          .first()
          .click()
        await p
          .locator(`[data-order-preview="${request.id}"]`)
          .getByRole('button', { name: 'Expand Order Request', exact: true })
          .click()
        const dialog = p.getByRole('dialog', {
          name: 'Order Request',
          exact: true,
        })
        await dialog.getByText('Active', { exact: true }).waitFor()
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Accept', exact: true })
            .count(),
          role === 'buyer' ? 1 : 0
        )
        const overflow = await dialog.evaluate(
          (el) =>
            [...el.querySelectorAll('*')].filter(
              (n) =>
                ['auto', 'scroll'].includes(getComputedStyle(n).overflowY) &&
                n.scrollHeight > n.clientHeight + 2
            ).length
        )
        assert(overflow <= (width >= 1280 ? 0 : 1))
        assert(
          await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)
        )
        await dialog.screenshot({
          path: path.join(root, `terms-active-${role}-${width}.png`),
        })
        results.push({
          role,
          width,
          kind: 'expanded-active-request',
          passed: true,
        })
        await p.close()
      }
      await c.close()
      console.log(
        `PASS ${role}: terminal/active controls at ${
          focused ? '1280' : 'four widths'
        }, linked outcome and navigation`
      )
    }
    assert.equal(writes, 0)
    assert.equal(errors, 0)
    console.log(
      JSON.stringify({
        checks: results.length,
        writes,
        errors,
        acceptWithoutMethod: true,
      })
    )
  } catch (e) {
    if (lastPage && !lastPage.isClosed())
      await lastPage.screenshot({ path: path.join(root, 'failure.png') })
    throw Error(stage + ': ' + e.message)
  } finally {
    await browser.close()
    const after = readNike()
    assert.deepEqual(after, before, 'Nike Order/Request/Listing changed')
    fs.writeFileSync(
      path.join(root, 'results.json'),
      JSON.stringify(
        { results, writes, errors, runtimeDiagnostics, nikeUnchanged: true },
        null,
        2
      )
    )
    console.log('PASS read-only Nike graph fingerprint unchanged')
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
