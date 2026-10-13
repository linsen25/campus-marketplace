// Real staging API/cookie qualification on NEW scoped fixtures only.
// No simulator UI, emails, signup, or mutation of preserved manual Requests.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
module.exports = async function ({ query, root, fingerprint, preflight }) {
  const guard = require('node:child_process').spawnSync(
    process.execPath,
    ['tests/financial-capabilities.browser.cjs'],
    { encoding: 'utf8', env: process.env }
  )
  assert.equal(guard.status, 0, guard.stdout + guard.stderr)
  console.log(guard.stdout.trim())
  const credentials = JSON.parse(
    fs.readFileSync('tests/artifacts/staging-demo/credentials.json', 'utf8')
  )
  const sellerId = credentials['seller-a'].id,
    buyerId = credentials['buyer-a'].id
  const marker = 'Financial API ' + crypto.randomUUID(),
    listings = []
  const scopeFile = path.join(root, 'browser-scope.json')
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const base = 'http://localhost:3000',
    headers = { Origin: base, 'X-Marketplace-Request': '1' }
  let seller,
    buyer,
    other,
    stage = 'login',
    errors = 0
  async function login(identity) {
    const c = await browser.newContext({
      serviceWorkers: 'block',
      viewport: { width: 1280, height: 900 },
    })
    c.setDefaultTimeout(20000)
    const a = credentials[identity]
    assert.equal(
      (
        await c.request.post(base + '/api/auth/sign-in', {
          headers,
          data: { email: a.email, password: a.password },
        })
      ).status(),
      200
    )
    return c
  }
  async function capability(c, capability, status) {
    const r = await c.request.post(
      base + '/api/financial-capabilities/test-state',
      { headers, data: { capability, status } }
    )
    assert.equal(r.status(), 200)
  }
  async function fixture(name, pending = false) {
    const lid = crypto.randomUUID()
    listings.push(lid)
    fs.writeFileSync(scopeFile, JSON.stringify({ listings, sellerId, marker }))
    query(
      `begin;alter table public.listings disable trigger listings_publication_boundary;insert into public.listings(id,seller_id,title,description,price_cents,currency,category,subcategory,condition,pickup_area,expected_image_count,published_at) select '${lid}','${sellerId}','${marker}','Isolated API fixture',8000,currency,category,subcategory,condition,pickup_area,1,now() from public.listings where published_at is not null limit 1;set constraints all immediate;alter table public.listings enable trigger listings_publication_boundary;commit;`
    )
    // Established real RPC conversation boundary; server-authoritative Request/Accept APIs.
    const cid = query(
      `begin;select set_config('request.jwt.claims','{"sub":"${buyerId}","role":"authenticated"}',true);select id from public.marketplace_find_or_create_conversation('${lid}');commit;`
    )[0].id
    const created = await seller.request.post(base + '/api/order-requests', {
      headers,
      data: {
        conversationId: cid,
        clientActionId: crypto.randomUUID(),
        terms: {
          item_amount_cents: 8000,
          fulfillment_type: 'shipping',
          shipping_cost_mode: pending ? 'pending' : 'included',
        },
      },
    })
    assert.equal(created.status(), 200)
    const request = await created.json()
    const accepted = await buyer.request.post(
      base + '/api/order-requests/' + request.id + '/accept',
      { headers, data: { clientActionId: crypto.randomUUID() } }
    )
    assert.equal(accepted.status(), 200)
    const { order } = await accepted.json()
    assert.equal(order.paymentStatus, 'pending')
    assert.equal(order.payoutStatus, 'not_eligible')
    assert.equal(order.paymentPaidAt, null)
    return { lid, cid, requestId: request.id, order }
  }
  async function simulate(c, f, key = crypto.randomUUID(), extra = {}) {
    return c.request.post(
      base + '/api/orders/' + f.order.id + '/simulate-payment-success',
      { headers, data: { clientActionId: key, ...extra } }
    )
  }
  try {
    seller = await login('seller-a')
    buyer = await login('buyer-a')
    other = await login('buyer-b')
    await capability(seller, 'payout_account', 'ready')
    stage = 'fixed fixture'
    const fixed = await fixture('fixed')
    assert.equal((await simulate(seller, fixed)).status(), 403)
    assert.equal((await simulate(other, fixed)).status(), 403)
    const anonymous = await browser.newContext()
    assert.equal((await simulate(anonymous, fixed)).status(), 401)
    await anonymous.close()
    for (const state of ['unset', 'needs_attention']) {
      await capability(buyer, 'payment_method', state)
      const r = await simulate(buyer, fixed)
      assert.equal(r.status(), 409)
      assert.equal((await r.json()).code, 'buyer_payment_method_not_ready')
    }
    await capability(buyer, 'payment_method', 'set')
    const pending = await fixture('pending', true)
    const denied = await simulate(buyer, pending)
    assert.equal(denied.status(), 409)
    assert.equal((await denied.json()).code, 'order_not_payment_ready')
    let uiPaid
    if (process.env.ORDER_PAYMENT_UI_TEST === '1') {
      const expired = await fixture('expired')
      query(
        `begin;alter table public.orders disable trigger orders_immutable;update public.orders set created_at=now()-interval '31 minutes',accepted_at=now()-interval '31 minutes',reservation_started_at=now()-interval '31 minutes',reservation_expires_at=now()-interval '1 minute' where id='${expired.order.id}';alter table public.orders enable trigger orders_immutable;commit;`
      )
      uiPaid = await require('./order-payment-ui.browser.cjs')({
        buyer,
        seller,
        fixed,
        shipping: pending,
        expired,
        capability,
        base,
        root,
      })
    }
    await capability(seller, 'payout_account', 'needs_attention')
    stage = 'success'
    const key = crypto.randomUUID()
    const result = await simulate(buyer, fixed, key, {
      buyerId: credentials['buyer-b'].id,
      payoutStatus: 'paid',
      paidAt: 'fake',
    })
    assert.equal(result.status(), 200)
    const paid = uiPaid || (await result.json()).order
    assert.equal(paid.paymentStatus, 'paid')
    assert.equal(paid.payoutStatus, 'not_eligible')
    assert.equal(paid.lifecycle, 'open')
    assert(paid.holdsListing && paid.paymentPaidAt)
    await capability(buyer, 'payment_method', 'unset')
    assert.equal((await simulate(buyer, fixed, key)).status(), 200)
    assert.equal((await simulate(buyer, fixed)).status(), 200)
    for (const c of [buyer, seller]) {
      for (let n = 0; n < 2; n++) {
        const r = await c.request.get(base + '/api/orders/' + fixed.order.id)
        assert.equal(r.status(), 200)
        const row = (await r.json()).order
        assert.equal(row.paymentStatus, 'paid')
        assert.equal(row.paymentPaidAt, paid.paymentPaidAt)
        assert.equal(row.payoutStatus, 'not_eligible')
      }
      const page = await c.newPage()
      page.setDefaultNavigationTimeout(60000)
      page.on('pageerror', () => errors++)
      const mode = c === buyer ? 'purchases' : 'sales'
      await page.goto(
        base +
          '/home?section=orders&destination=' +
          mode +
          '&order=' +
          fixed.order.id,
        { waitUntil: 'domcontentloaded' }
      )
      await page
        .locator('[data-formal-order="' + fixed.order.id + '"]')
        .waitFor()
      await page.getByText('Payment paid', { exact: true }).first().waitFor()
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.getByText('Payment paid', { exact: true }).first().waitFor()
      assert.equal(
        await page.getByText('reservation remaining', { exact: false }).count(),
        0
      )
      await page.close()
    }
    const count = query(
      `select count(*) count from public.transaction_events where order_id='${fixed.order.id}' and event_type='payment_paid'`
    )[0].count
    assert.equal(count, 1)
    assert.equal(errors, 0)
    console.log(
      'PASS real Buyer-only staging API: Seller/outsider/anonymous denied; method gates; shipping pending rejected; Paid/Payout independent; identity injection ignored; one event/idempotent timestamp; Buyer/Seller persisted reads and refreshed UI; no runtime errors'
    )
  } catch (e) {
    throw Error('Browser ' + stage + ': ' + e.message)
  } finally {
    if (buyer) await capability(buyer, 'payment_method', 'unset')
    if (seller) await capability(seller, 'payout_account', 'unset')
    await browser.close()
    if (listings.length) {
      const ids = listings.map((id) => `'${id}'`).join(',')
      query(
        `begin;lock table public.listings,public.orders,public.order_requests,public.transaction_events,marketplace_private.order_commands,public.conversations in access exclusive mode;alter table public.listings disable trigger user;alter table public.orders disable trigger user;alter table public.order_requests disable trigger user;alter table public.transaction_events disable trigger user;delete from public.transaction_events where conversation_id in(select id from public.conversations where listing_id in(${ids}));delete from marketplace_private.order_commands where request_id in(select id from public.order_requests where listing_id in(${ids}));update public.listings set status='available',reserved_order_id=null where id in(${ids}) and seller_id='${sellerId}' and title='${marker}';delete from public.orders where listing_id in(${ids});delete from public.order_requests where listing_id in(${ids});delete from public.conversations where listing_id in(${ids});delete from public.listings where id in(${ids}) and seller_id='${sellerId}' and title='${marker}';set constraints all immediate;alter table public.listings enable trigger user;alter table public.orders enable trigger user;alter table public.order_requests enable trigger user;alter table public.transaction_events enable trigger user;commit;`
      )
    }
    assert.deepEqual(fingerprint(), preflight.fingerprint)
    assert.equal(
      query(
        'select count(*) count from marketplace_private.financial_capabilities'
      )[0].count,
      0
    )
    if (fs.existsSync(scopeFile)) fs.unlinkSync(scopeFile)
    console.log(
      'PASS browser fixtures removed, canonical capabilities restored to Unset and history fingerprints unchanged'
    )
  }
}
