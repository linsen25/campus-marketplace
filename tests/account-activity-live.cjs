const fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  assert = require('node:assert/strict')
assert(
  !fs.existsSync('tests/artifacts/meetup-d1-fixtures/scope.json'),
  'Existing fixture journal requires exact recovery first'
)
const h = require('./order-meetup-fixtures.cjs'),
  {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
const ok = (r) => {
    assert(!r.error, r.error?.code || 'Synthetic request failed')
    return r.data
  },
  id = () => crypto.randomUUID()
const base = 'http://localhost:3000',
  headers = { Origin: base, 'X-Marketplace-Request': '1' }
;(async () => {
  const baseline = await h.fingerprint()
  let browser
  try {
    await h.setup()
    const f = await h.fixture('on_campus', false)
    const listing = (
      await h.query(`select title from public.listings where id=${h.q(f.lid)}`)
    )[0]
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
    const anon = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
      }),
      owner = await browser.newContext({
        viewport: { width: 1280, height: 900 },
        serviceWorkers: 'block',
      })
    const login = await owner.request.post(base + '/api/auth/sign-in', {
      headers,
      data: h.accounts[0],
    })
    assert(login.ok(), 'Owner synthetic session')
    const p = await anon.newPage()
    await p.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
      r.abort()
    )
    await p.goto(base + '/listings', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    })
    const card = p
      .locator('[data-market-card]')
      .filter({ has: p.getByAltText(listing.title, { exact: true }) })
      .first()
      .locator('[data-slot="expandable-card"]')
    await card.waitFor()
    let command
    for (let i = 0; i < 2; i++) {
      const response = p.waitForResponse(
        (r) =>
          r.url().endsWith('/api/listings/view') &&
          r.request().method() === 'POST'
      )
      await card.click()
      await p.getByRole('dialog').waitFor()
      const r = await response
      assert(r.ok())
      assert((await r.json()).recorded)
      if (i === 0) command = r.request().postDataJSON()
      await p.keyboard.press('Escape')
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      await p.waitForTimeout(100)
    }
    let r = await anon.request.post(base + '/api/listings/view', {
      headers,
      data: command,
    })
    assert(r.ok())
    r = await owner.request.post(base + '/api/listings/view', {
      headers,
      data: { listingId: f.lid, eventId: id() },
    })
    assert(r.ok())
    assert.equal((await r.json()).recorded, false)
    const count = async (lid, kind) =>
      Number(
        (
          await h.query(
            `select count(*) n from marketplace_private.account_activity_events where listing_origin_id=${h.q(
              lid
            )} and kind=${h.q(kind)}`
          )
        )[0].n
      )
    assert.equal(await count(f.lid, 'view'), 2)
    assert.equal(await count(f.lid, 'listing_published'), 1)
    r = await owner.request.get(base + '/api/profile/activity?period=1D')
    assert(r.ok())
    const activity = await r.json()
    assert.equal(activity.points.length, 24)
    assert.equal(
      activity.points.reduce((n, p) => n + p.views, 0),
      2
    )
    assert.equal(
      activity.points.reduce((n, p) => n + p.listings, 0),
      1
    )
    r = await owner.request.post(base + '/api/listings/' + f.lid + '/sold', {
      headers,
      data: {},
    })
    assert(r.ok())
    assert.equal(await count(f.lid, 'listing_sold'), 1)
    console.log(
      'PASS staging real Marketplace opens +2, same-command retry +0, own write +0; Activity API exact owner buckets; real manual Sold +1'
    )
    await h.capability('set', 1, 'payment_method')
    const completed = await h.accepted()
    for (const c of [h.clients[0], h.clients[1]])
      ok(
        await c.rpc('marketplace_confirm_order_agreement', {
          p_order_id: completed.order.id,
        })
      )
    const payment = ok(
      await h.clients[1].rpc('marketplace_start_order_payment', {
        p_order_id: completed.order.id,
        p_client_action_id: id(),
      })
    )
    ok(
      await h.admin.rpc('marketplace_resolve_campus_payment', {
        p_attempt_id: payment.attemptId,
        p_success: true,
      })
    )
    assert.equal(
      await count(completed.lid, 'listing_sold'),
      0,
      'Paid is not Sold'
    )
    const credential = ok(
      await h.clients[1].rpc('marketplace_handoff_credential', {
        p_order_id: completed.order.id,
      })
    )
    ok(
      await h.clients[0].rpc('marketplace_verify_handoff', {
        p_order_id: completed.order.id,
        p_channel: 'code',
        p_credential: credential.code,
        p_client_action_id: id(),
      })
    )
    await h.query(
      `begin;update marketplace_private.order_protection set started_at=t.v-interval '25 hours',expires_at=t.v-interval '1 hour' from(select clock_timestamp() v)t where order_id=${h.q(
        completed.order.id
      )};select marketplace_private.settle_order_protection(${h.q(
        completed.lid
      )});select marketplace_private.settle_order_protection(${h.q(
        completed.lid
      )});commit;`
    )
    assert.equal(await count(completed.lid, 'listing_sold'), 1)
    console.log(
      'PASS staging authoritative Agreement -> Paid (+0 Sold) -> handoff -> Protection -> Completed (+1 Sold); repeated settlement +0'
    )
  } finally {
    if (browser) await browser.close()
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      baseline,
      'Canonical/manual data fingerprints unchanged'
    )
    const left = await h.query(
      `select count(*) n from marketplace_private.account_activity_events where owner_id in(${h.set(
        h.users
      )})`
    )
    assert.equal(Number(left[0].n), 0)
    for (const c of h.clients) c.auth.stopAutoRefresh()
    console.log(
      'PASS synthetic users/listings/offers/orders/events/public/private media cleaned; canonical/manual fingerprints unchanged'
    )
    for (const name of fs.readdirSync(h.root))
      fs.unlinkSync(path.join(h.root, name))
    fs.rmdirSync(h.root)
  }
})().catch((e) => {
  console.error(e.stack)
  process.exitCode = 1
})
