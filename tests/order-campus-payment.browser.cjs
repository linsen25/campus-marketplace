const assert = require('node:assert/strict'),
  path = require('node:path'),
  fs = require('node:fs'),
  crypto = require('node:crypto')
const h = require('./order-meetup-fixtures.cjs')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
const origin = 'http://localhost:3000'
const button = (p, name) => p.getByRole('button', { name, exact: true })
const inspected = 'Continue to payment'
const panel = (p) => p.locator('[data-campus-payment]')
async function matrix(p, state) {
  for (const width of [390, 430, 1280, 1536]) {
    await p.setViewportSize({ width, height: 900 })
    assert(
      await p.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      `${state} overflow ${width}`
    )
    // React's responsive workspace transition settles after viewport resize.
    // Poll the actual panel bounds; persistent overflow still fails within 5s.
    let box
    for (let attempt = 0; attempt < 25; attempt++) {
      box = await panel(p).boundingBox()
      if (box && box.x >= 0 && box.x + box.width <= width + 1) break
      await p.waitForTimeout(200)
    }
    assert(box && box.x >= 0 && box.x + box.width <= width + 1,
      `${state} panel overflow ${width}: ${JSON.stringify(box)}`)
    await p.screenshot({ path: path.join(h.root, `d2a-${state}-${width}.png`), fullPage: true })
  }
  console.log('PASS responsive ' + state + ' 390/430/1280/1536')
}
;(async () => {
  const baseline = await h.fingerprint(),
    contexts = [],
    errors = [],
    incoming = [0, 0, 0],
    requests = [],
    reads = [],
    pages = []
  let browser, failure
  try {
    await h.setup()
    const f = await h.accepted('on_campus', true)
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
    for (const i of [0, 1, 3]) {
      const c = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        timezoneId: 'America/Toronto',
        serviceWorkers: 'allow',
      })
      contexts.push(c)
      await c.addInitScript(() => {
        const interval = window.setInterval.bind(window)
        window.setInterval = (callback, delay, ...args) =>
          interval(delay === 15000 ? () => {} : callback, delay, ...args)
      })
      const r = await c.request.post(origin + '/api/auth/sign-in', {
        headers: { Origin: origin, 'X-Marketplace-Request': '1' },
        data: h.accounts[i],
      })
      assert.equal(r.status(), 200)
      const p = await c.newPage(),
        ix = pages.length
      pages.push(p)
      p.on('pageerror', (e) => errors.push(e.message))
      p.on('response', async (r) => {
        if (!/\/api\/orders(?:\/|\?|$)/.test(r.url())) return
        const row = { viewer: ix, status: r.status(), payment: [] }
        try {
          const data = await r.json()
          row.payment = (data.orders || [data.order]).filter(Boolean).map(o => o.paymentStatus)
        } catch {}
        reads.push(row)
      })
      p.on('request', (r) => {
        if (
          r.method() === 'POST' &&
          /\/api\/orders\/.*\/(inspection|payment)\//.test(r.url())
        )
          requests.push({
            url: r.url(),
            keys: Object.keys(r.postDataJSON() || {}),
          })
      })
      p.on('websocket', (s) =>
        s.on('framereceived', ({ payload }) => {
          const frame =
            typeof payload === 'string' ? payload : payload.toString('utf8')
          if (
            frame.includes('messages_changed') &&
            frame.includes(f.order.conversation_id)
          )
            incoming[ix]++
        })
      )
      await p.goto(
        origin +
          '/home?section=orders&destination=' +
          (i === 0 ? 'sales' : 'purchases') +
          (i === 3 ? '' : '&order=' + f.order.id)
      )
      if (i !== 3)
        await p
          .locator(`[data-formal-order="${f.order.id}"]`)
          .waitFor({ timeout: 60000 })
    }
    const [seller, buyer] = pages
    await panel(buyer).waitFor()
    await panel(seller).waitFor()
    assert.equal(await button(seller, inspected).count(), 0)
    assert.equal(await button(buyer, 'Pay (staging test)').count(), 0)
    await matrix(buyer, 'before-inspection')
    await matrix(seller, 'seller-before-payment')
    await button(buyer, inspected).click()
    await panel(seller)
      .getByText(
        'The Buyer has inspected the item and chosen to continue to payment.',
        { exact: true }
      )
      .waitFor({ timeout: 45000 })
    await button(buyer, 'Payments Settings').waitFor({ timeout: 45000 })
    await matrix(buyer, 'inspection-setup-required')
    await h.capability('needs_attention', 1, 'payment_method')
    await buyer.evaluate(() =>
      window.dispatchEvent(new Event('marketplace-financial-changed'))
    )
    await panel(buyer)
      .getByText('Your payment method needs attention.', { exact: true })
      .waitFor({ timeout: 45000 })
    await matrix(buyer, 'needs-attention')
    await h.capability('set', 1, 'payment_method')
    await buyer.evaluate(() =>
      window.dispatchEvent(new Event('marketplace-financial-changed'))
    )
    await button(buyer, 'Pay (staging test)').waitFor({
      timeout: 45000,
    })
    // Deliberately stale Set cache: server capability changed without a client event.
    await h.capability('needs_attention', 1, 'payment_method')
    await button(buyer, 'Pay (staging test)').click()
    await panel(buyer)
      .getByText('Your payment method needs attention.', { exact: true })
      .waitFor({ timeout: 45000 })
    await button(buyer, 'Payments Settings').waitFor()
    assert.equal(
      (
        await h.query(
          `select count(*) n from marketplace_private.campus_payment_attempts where order_id=${h.q(
            f.order.id
          )};`
        )
      )[0].n,
      0
    )
    await button(buyer, 'Refresh Order').click()
    await h.capability('set', 1, 'payment_method')
    await buyer.evaluate(() =>
      window.dispatchEvent(new Event('marketplace-financial-changed'))
    )
    await button(buyer, 'Pay (staging test)').waitFor({ timeout: 45000 })
    await buyer.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Pay (staging test)' && !b.disabled))
    console.log(
      'PASS stale Set cache cannot bypass server readiness; safe Settings recovery; zero attempts'
    )
    const a = await h.clients[1].rpc('marketplace_start_campus_payment', {
      p_order_id: f.order.id,
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!a.error, a.error?.message)
    assert.equal(a.data.status, 'processing')
    console.log('PASS authoritative Processing start committed')
    for (const p of [buyer, seller]) {
      await p
        .locator('[data-campus-payment="processing"]')
        .waitFor({ timeout: 45000 })
      assert.equal(await button(p, 'Cancel Order').count(), 0)
      await matrix(p, p === buyer ? 'buyer-processing' : 'seller-processing')
    }
    assert.equal(await button(seller, 'Pay (staging test)').count(), 0)
    const failed = await h.admin.rpc('marketplace_resolve_campus_payment', {
      p_attempt_id: a.data.attemptId,
      p_success: false,
    })
    assert(!failed.error, failed.error?.message)
    await button(buyer, 'Retry test payment').waitFor({ timeout: 45000 })
    await seller
      .locator('[data-campus-payment="failed"]')
      .waitFor({ timeout: 45000 })
    await matrix(buyer, 'buyer-failed')
    await matrix(seller, 'seller-failed')
    await button(buyer, 'Retry test payment').click()
    for (const p of [buyer, seller]) {
      await p
        .locator('[data-campus-payment="paid"]')
        .waitFor({ timeout: 45000 })
      assert.equal(await button(p, 'Cancel Order').count(), 0)
      assert.equal(await button(p, 'Propose new meetup').count(), 0)
      await matrix(p, p === buyer ? 'buyer-paid' : 'seller-paid')
    }
    await buyer.reload()
    await buyer
      .locator('[data-campus-payment="paid"]')
      .waitFor({ timeout: 60000 })
    assert(incoming[0] >= 4 && incoming[1] >= 4)
    assert.equal(incoming[2], 0)
    assert(requests.some((r) => r.url.endsWith('/inspection/confirm')))
    assert(requests.some((r) => r.url.endsWith('/payment/start')))
    for (const r of requests) assert.deepEqual(r.keys, ['clientActionId'])
    assert.deepEqual(errors, [])
    const facts = (
      await h.query(`select o.lifecycle_status,o.payment_status,o.payout_status,l.status listing,
  (select count(*) from public.orders where listing_id=o.listing_id) orders,
  (select count(*) from public.transaction_events where order_id=o.id and event_type='payment_paid') paid_events
  from public.orders o join public.listings l on l.id=o.listing_id where o.id=${h.q(
    f.order.id
  )};`)
    )[0]
    assert.equal(facts.lifecycle_status, 'open')
    assert.equal(facts.payment_status, 'paid')
    assert.equal(facts.listing, 'pending')
    assert.equal(facts.payout_status, 'not_eligible')
    assert.equal(facts.orders, 1)
    assert.equal(facts.paid_events, 1)
    const recovering = await h.accepted()
    assert(
      !(
        await h.clients[1].rpc('marketplace_confirm_campus_inspection', {
          p_order_id: recovering.order.id,
          p_client_action_id: crypto.randomUUID(),
        })
      ).error
    )
    const pending = await h.clients[1].rpc('marketplace_start_campus_payment', {
      p_order_id: recovering.order.id,
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!pending.error)
    await buyer.goto(
      origin +
        '/home?section=orders&destination=purchases&order=' +
        recovering.order.id
    )
    await buyer
      .locator('[data-campus-payment="processing"]')
      .waitFor({ timeout: 60000 })
    await button(buyer, 'Refresh payment').click()
    await buyer
      .locator('[data-campus-payment="paid"]')
      .waitFor({ timeout: 45000 })
    assert.equal(
      (
        await h.query(
          `select count(*) n from marketplace_private.campus_payment_attempts where order_id=${h.q(
            recovering.order.id
          )};`
        )
      )[0].n,
      1
    )
    console.log(
      'PASS browser restart reconciles existing Processing intent without a second attempt'
    )
    console.log(
      JSON.stringify({
        privateInvalidations: incoming,
        pollingDisabled: true,
        runtimeErrors: errors.length,
        primaryUiPosts: requests.length,
        refreshPersisted: true,
        ...facts,
      })
    )
  } catch (e) {
    failure = e
    const states = []
    for (const p of pages) {
      try { states.push(await panel(p).getAttribute('data-campus-payment', { timeout: 1000 })) } catch { states.push(null) }
    }
    console.log(JSON.stringify({ diagnostic: true, states, incoming, reads, runtimeErrors: errors.length }))
  } finally {
    for (const c of contexts) await c.close()
    if (browser) await browser.close()
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), baseline)
  }
  if (failure) throw failure
  console.log(
    'PASS D2A real Buyer/Seller UI, role-only actions, private Realtime, authoritative Processing/Failed/Paid, responsive states, cleanup'
  )
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
