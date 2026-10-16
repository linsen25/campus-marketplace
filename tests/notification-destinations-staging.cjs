// Real local app + isolated staging business fixtures. No email worker invocation.
const fs = require('fs'),
  path = require('path'),
  Module = require('module'),
  crypto = require('crypto'),
  assert = require('assert/strict')
const scope = 'tests/artifacts/notification-destination-fixtures'
fs.mkdirSync(scope, { recursive: true })
assert(
  !fs.existsSync(scope + '/scope.json'),
  'Inspect previous exact fixture journal before another run'
)
const m = new Module(
  path.resolve('tests/notification-destination-fixtures.cjs'),
  module
)
m.filename = path.resolve('tests/notification-destination-fixtures.cjs')
m.paths = Module._nodeModulePaths(path.dirname(m.filename))
m._compile(
  fs
    .readFileSync('tests/order-meetup-fixtures.cjs', 'utf8')
    .replaceAll('tests/artifacts/meetup-d1-fixtures', scope),
  m.filename
)
const h = m.exports
const base = 'http://localhost:3000'
async function cleanup() {
  // The older media fixture helper predates these cancellation sidecars.
  // Remove them only after verifying every exact journaled Order's ownership.
  const journal = JSON.parse(fs.readFileSync(scope + '/scope.json', 'utf8'))
  if (journal.orders.length) {
    const ids = h.set(journal.orders)
    await h.query(`begin;do $$begin
      if exists(select 1 from public.orders o join public.listings l on l.id=o.listing_id
        where o.id in(${ids}) and (l.title<>${h.q(journal.marker)} or
        l.seller_id<>${h.q(journal.users[0])} or l.id not in(${h.set(
      journal.listings
    )})))
      then raise exception 'Synthetic cancellation cleanup ownership mismatch';end if;
      end;$$;
      delete from marketplace_private.order_flow_commands where order_id in(${ids});
      delete from marketplace_private.order_settlement_authorizations where order_id in(${ids});
      delete from marketplace_private.order_cancellation_intents where order_id in(${ids});
      delete from marketplace_private.seller_delivery_starts where order_id in(${ids});commit;`)
  }
  await h.cleanup()
}
(async () => {
  const original = await h.fingerprint(),
    envHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync('.env.local'))
      .digest('hex')
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    await h.setup()
    const fixture = await h.fixture()
    const rows = await h.query(
      `select conversation_id from public.order_requests where id=${h.q(
        fixture.offer
      )};`
    )
    const cid = rows[0].conversation_id
    const c = await browser.newContext()
    assert(
      (
        await c.request.post(base + '/api/auth/sign-in', {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: h.accounts[1],
        })
      ).ok()
    )
    const p = await c.newPage()
    p.setDefaultTimeout(30000)
    const notifications = async () => {
      await p.goto(base + '/home?section=notifications')
      await p.getByRole('region', { name: 'Notifications feed' }).waitFor()
    }
    const open = async (title) => {
      await notifications()
      await p
        .getByRole('region', { name: 'Notifications feed' })
        .getByRole('button', { name: new RegExp('^' + title) })
        .first()
        .click()
    }
    await open('New offer received')
    await p.getByRole('dialog').waitFor()
    assert(p.url().includes('conversation=' + cid))
    assert(p.url().includes('offer=' + fixture.offer))
    console.log(
      'PASS real Offer notification -> exact conversation and Offer Detail'
    )
    let r = await h.clients[0].rpc('marketplace_send_text', {
      p_conversation_id: cid,
      p_client_message_id: crypto.randomUUID(),
      p_content: 'Isolated notification navigation test',
    })
    assert(!r.error, r.error?.message)
    await open('New message')
    await p
      .getByText('Isolated notification navigation test', { exact: true })
      .waitFor()
    assert(p.url().includes('conversation=' + cid))
    assert(!p.url().includes('&offer='))
    console.log('PASS real message notification -> exact conversation')
    const batch = await h.prepare(fixture)
    r = await h.accept(fixture, batch)
    assert(!r.error, r.error?.message)
    const oid = r.data.id
    await open('Agreement needs your confirmation')
    await p
      .locator(`[data-formal-order="${oid}"][data-order-page="review"]`)
      .waitFor()
    assert(p.url().includes('destination=purchases'))
    console.log(
      'PASS real Agreement notification -> exact Buyer Order, authoritative Agreement stage'
    )
    for (const client of [h.clients[1], h.clients[0]]) {
      r = await client.rpc('marketplace_confirm_order_agreement', {
        p_order_id: oid,
      })
      assert(!r.error, r.error?.message)
    }
    await open('Agreement confirmed')
    await p
      .locator(`[data-formal-order="${oid}"][data-order-page="payment"]`)
      .waitFor()
    console.log(
      'PASS real completed-Agreement notification -> authoritative Payment stage'
    )
    await open('Agreement needs your confirmation')
    await p
      .locator(`[data-formal-order="${oid}"][data-order-page="payment"]`)
      .waitFor()
    console.log(
      'PASS older Agreement notification respects advanced Payment authority'
    )
    r = await h.clients[1].rpc('marketplace_cancel_order', {
      p_order_id: oid,
      p_reason: 'buyer_changed_mind',
      p_note: 'Synthetic notification navigation test',
      p_client_action_id: crypto.randomUUID(),
    })
    assert(
      !r.error && !r.data.errorCode,
      r.error?.message || 'Cancellation rejected'
    )
    await open('Agreement confirmed')
    await p
      .locator(`[data-formal-order="${oid}"][data-order-page="closed"]`)
      .waitFor()
    console.log(
      'PASS older Payment notification -> terminal read-only Order history after authoritative cancellation'
    )
    const seller = await browser.newContext()
    assert(
      (
        await seller.request.post(base + '/api/auth/sign-in', {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: h.accounts[0],
        })
      ).ok()
    )
    const sp = await seller.newPage()
    await sp.goto(base + '/home?section=notifications')
    await sp
      .getByRole('region', { name: 'Notifications feed' })
      .getByRole('button', { name: /^Order cancelled/ })
      .click()
    await sp
      .locator(`[data-formal-order="${oid}"][data-order-page="closed"]`)
      .waitFor()
    assert(sp.url().includes('destination=sales'))
    console.log(
      'PASS real Seller cancelled notification -> exact Sales historical Order'
    )
  } finally {
    await browser.close()
    await cleanup()
    assert.deepEqual(await h.fingerprint(), original, 'Original data unchanged')
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('.env.local'))
        .digest('hex'),
      envHash
    )
    fs.unlinkSync(scope + '/scope.json')
    console.log(
      'PASS complete synthetic graph/media cleanup; canonical/manual/D1 and .env.local unchanged'
    )
  }
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
