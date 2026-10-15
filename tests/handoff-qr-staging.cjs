/* global window, navigator, Image, Blob, document, XMLSerializer */
// Real authenticated staging sessions + actual QR decoder, using disposable fixtures only.
// Camera frames are supplied in memory from the Buyer's real QR SVG; no credentials are logged/saved.
const fs = require('node:fs'),
  path = require('node:path'),
  Module = require('node:module'),
  assert = require('node:assert/strict'),
  crypto = require('node:crypto')
const fixtureRoot = 'tests/artifacts/handoff-qr-fixtures'
const recovery = process.argv[2] === 'recover'
assert(
  recovery || !fs.existsSync(fixtureRoot + '/scope.json'),
  'Existing scoped QR journal requires inspection before another run'
)
const filename = path.resolve('tests/handoff-qr-scoped-fixtures.cjs'),
  moduleCopy = new Module(filename, module)
moduleCopy.filename = filename
moduleCopy.paths = Module._nodeModulePaths(path.dirname(filename))
moduleCopy._compile(
  fs
    .readFileSync('tests/order-meetup-fixtures.cjs', 'utf8')
    .replaceAll('tests/artifacts/meetup-d1-fixtures', fixtureRoot)
    .replaceAll('D1Meetup_', 'QRHandoff_')
    .replace(
      'delete from marketplace_private.buyer_receipt_commands',
      () =>
        'delete from marketplace_private.order_flow_commands where order_id in(select id from public.orders where listing_id in(${lids}));\ndelete from marketplace_private.order_settlement_authorizations where order_id in(select id from public.orders where listing_id in(${lids}));\ndelete from marketplace_private.order_cancellation_intents where order_id in(select id from public.orders where listing_id in(${lids}));\ndelete from marketplace_private.seller_delivery_starts where order_id in(select id from public.orders where listing_id in(${lids}));\ndelete from marketplace_private.buyer_receipt_commands'
    ),
  filename
)
const h = moduleCopy.exports
const base = 'http://localhost:3000',
  uuid = () => crypto.randomUUID(),
  ok = (r) => {
    assert(
      !r.error,
      'Staging operation rejected: ' + (r.error?.code || 'transport')
    )
    return r.data
  },
  pass = (s) => console.log('PASS ' + s)
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
let browser
const contexts = []
async function post(context, id, operation, body) {
  return context.request.post(
    base + '/api/order-domain/' + id + '/' + operation,
    { headers: { Origin: base, 'X-Marketplace-Request': '1' }, data: body }
  )
}
async function delivery(method) {
  const f = await h.fixture('on_campus', false)
  const offer = ok(
    await h.clients[0].rpc('marketplace_submit_offer', {
      p_conversation_id: f.conversationId,
      p_terms: {
        item_amount_cents: 7500,
        fulfillment: 'delivery',
        delivery_method: method,
        delivery_fee_cents: 1000,
        delivery_area: {
          country_code: 'CA',
          province_code: 'ON',
          city_label: 'London',
          postal_prefix: 'N6A',
        },
        note: 'Disposable QR qualification',
      },
      p_client_action_id: uuid(),
      p_kind: 'create',
    })
  )
  h.offers.push(offer.id)
  h.journal()
  f.offer = offer.id
  const command = uuid(),
    batch = await h.prepare(f, command)
  f.order = ok(await h.accept(f, batch, command))
  h.orders.push(f.order.id)
  h.journal()
  return f
}
async function paid(f, buyer) {
  for (const client of [h.clients[1], h.clients[0]])
    ok(
      await client.rpc('marketplace_confirm_order_agreement', {
        p_order_id: f.order.id,
      })
    )
  if (f.order.terms_snapshot.terms.fulfillment === 'delivery') {
    let r = await post(buyer, f.order.id, 'checkout', {})
    assert(r.ok(), 'Synthetic checkout')
    r = await post(buyer, f.order.id, 'address', {
      address: {
        country_code: 'CA',
        province_code: 'ON',
        city: 'London',
        postal_code: 'N6A1A1',
        street: 'Disposable QR test address',
      },
    })
    assert(r.ok(), 'Synthetic address')
  }
  const r = await post(buyer, f.order.id, 'payment', { clientActionId: uuid() })
  assert(r.ok(), 'Existing staging payment path')
  const state = ok(
    await h.clients[1].rpc('marketplace_order_fulfillment', {
      p_order_id: f.order.id,
    })
  )
  assert(state.orderId === f.order.id)
}
async function open(context, f, role, width = 390) {
  const p = await context.newPage()
  await p.setViewportSize({ width, height: 900 })
  await p.goto(
    base +
      '/home?section=orders&destination=' +
      (role === 'buyer' ? 'purchases' : 'sales') +
      '&order=' +
      f.order.id
  )
  await p.locator('[data-formal-order]').waitFor({ timeout: 60000 })
  await p
    .locator('[data-current-step]:not([data-current-step="loading"])')
    .waitFor({ timeout: 60000 })
  return p
}
async function scan(buyerPage, sellerPage) {
  const svg = await buyerPage
    .getByRole('img', { name: /Handoff QR/ })
    .locator('svg')
    .evaluate((e) => new XMLSerializer().serializeToString(e))
  await sellerPage.evaluate((svg) => {
    window.fakeQrSvg = svg
  }, svg)
  const result = sellerPage.waitForResponse(
    (r) => r.url().endsWith('/handoff') && r.request().method() === 'POST',
    { timeout: 30000 }
  )
  await sellerPage
    .getByRole('button', { name: 'Open scanner', exact: true })
    .click()
  const response = await result
  assert(
    response.ok(),
    'Actual scanner submits successful authoritative verification'
  )
  await sellerPage.getByRole('dialog').waitFor({ state: 'detached' })
  assert(
    await sellerPage.evaluate(() =>
      window.cameraStreams.every((s) =>
        s.getTracks().every((t) => t.readyState === 'ended')
      )
    ),
    'Camera stopped after actual QR decode'
  )
}
async function run() {
  const baseline = await h.fingerprint(),
    envHash = crypto
      .createHash('sha256')
      .update(fs.readFileSync('.env.local'))
      .digest('hex')
  fs.writeFileSync(
    fixtureRoot + '/qualification-baseline.json',
    JSON.stringify(baseline)
  )
  try {
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
    for (const who of [1, 0]) {
      const c = await browser.newContext()
      contexts.push(c)
      const a = h.accounts[who],
        r = await c.request.post(base + '/api/auth/sign-in', {
          headers: { Origin: base, 'X-Marketplace-Request': '1' },
          data: { email: a.email, password: a.password },
        })
      assert(r.ok(), 'Real isolated staging account signs in')
    }
    const [buyer, seller] = contexts
    await seller.addInitScript(() => {
      window.cameraStreams = []
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints.audio !== false) throw Error('Audio must be disabled')
        const svg = window.fakeQrSvg
        if (!svg) throw Error('No controlled QR frame')
        delete window.fakeQrSvg
        const image = new Image(),
          url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
        await new Promise((resolve, reject) => {
          image.onload = resolve
          image.onerror = reject
          image.src = url
        })
        URL.revokeObjectURL(url)
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 640
        const ctx = canvas.getContext('2d'),
          draw = () => {
            ctx.fillStyle = 'white'
            ctx.fillRect(0, 0, 640, 640)
            ctx.drawImage(image, 100, 100, 440, 440)
          }
        draw()
        const stream = canvas.captureStream(10),
          timer = setInterval(draw, 100)
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track)
          track.stop = () => {
            clearInterval(timer)
            stop()
          }
        }
        window.cameraStreams.push(stream)
        return stream
      }
    })
    const meeting = await h.accepted(),
      manual = await h.accepted(),
      deliveryOrder = await delivery('seller_delivery'),
      courier = await delivery('courier')
    pass('Four isolated accepted Orders; no canonical fixtures used')
    let r = await post(seller, meeting.order.id, 'handoff', {
      channel: 'qr',
      credential: 'a'.repeat(64),
      clientActionId: uuid(),
    })
    assert(r.status() === 400, 'Unpaid handoff rejected')
    let bp = await open(buyer, meeting, 'buyer', 390),
      sp = await open(seller, meeting, 'seller', 1280)
    assert.equal(
      await bp.locator('[data-formal-order]').getAttribute('data-order-page'),
      'review'
    )
    let agreement = ok(
      await h.clients[1].rpc('marketplace_order_agreement', {
        p_order_id: meeting.order.id,
      })
    )
    assert(
      !agreement.complete &&
        !agreement.buyerConfirmedAt &&
        !agreement.sellerConfirmedAt
    )
    assert(
      await bp.getByRole('button', { name: 'Next', exact: true }).isDisabled()
    )
    await bp
      .getByRole('button', { name: 'Confirm Agreement', exact: true })
      .click()
    await bp.getByText(/Agreement confirmed. Waiting for the Seller/).waitFor()
    r = await post(buyer, meeting.order.id, 'payment', {
      clientActionId: uuid(),
    })
    assert(!r.ok(), 'One acknowledgement cannot pay')
    await sp
      .getByRole('button', { name: 'Confirm Agreement', exact: true })
      .click()
    await sp.locator('[data-order-page="payment"]').waitFor({ timeout: 30000 })
    await bp.locator('[data-order-page="payment"]').waitFor({ timeout: 40000 })
    agreement = ok(
      await h.clients[1].rpc('marketplace_order_agreement', {
        p_order_id: meeting.order.id,
      })
    )
    assert(
      agreement.complete &&
        agreement.buyerConfirmedAt &&
        agreement.sellerConfirmedAt
    )
    await bp.close()
    await sp.close()
    pass(
      'Fresh Agreement current; Buyer-only acknowledgement blocks Payment; both real authenticated sessions automatically reach Payment after Seller confirmation'
    )
    await paid(meeting, buyer)
    await paid(manual, buyer)
    await paid(deliveryOrder, buyer)
    await paid(courier, buyer)
    bp = await open(buyer, meeting, 'buyer')
    sp = await open(seller, meeting, 'seller')
    assert.equal(await bp.getByRole('img', { name: /Handoff QR/ }).count(), 0)
    await bp
      .getByRole('button', { name: 'Generate QR code', exact: true })
      .click()
    await bp.getByRole('img', { name: /Handoff QR/ }).waitFor()
    assert(await bp.getByLabel('6-digit handoff code').isVisible())
    assert(
      await sp
        .getByRole('button', { name: 'Open scanner', exact: true })
        .isVisible()
    )
    assert(
      await sp.getByRole('tab', { name: 'Enter code', exact: true }).isVisible()
    )
    let successfulBody
    sp.on('request', (req) => {
      if (req.method() === 'POST' && req.url().endsWith('/handoff'))
        successfulBody = req.postDataJSON()
    })
    await scan(bp, sp)
    await bp
      .locator('[data-current-step="protection"]')
      .waitFor({ timeout: 30000 })
    await sp
      .locator('[data-current-step="protection"]')
      .waitFor({ timeout: 30000 })
    pass(
      'Actual QR decoded and verified; both authenticated UIs show Protection'
    )
    const f = ok(
      await h.clients[1].rpc('marketplace_order_fulfillment', {
        p_order_id: meeting.order.id,
      })
    )
    assert(
      f.handoffConfirmedAt && f.protectionStartedAt,
      'Authoritative handoff and Protection timestamps'
    )
    assert(
      Date.parse(f.protectionExpiresAt) - Date.parse(f.protectionStartedAt) ===
        86400000
    )
    r = await post(seller, meeting.order.id, 'handoff', successfulBody)
    assert(r.ok(), 'Same successful command idempotent')
    r = await post(seller, meeting.order.id, 'handoff', {
      ...successfulBody,
      clientActionId: uuid(),
    })
    assert((await r.json()).errorCode === 'handoff_already_redeemed')
    r = await post(seller, meeting.order.id, 'handoff', {
      channel: 'code',
      credential: ok(
        await h.clients[1].rpc('marketplace_handoff_credential', {
          p_order_id: manual.order.id,
        })
      ).code,
      clientActionId: uuid(),
    })
    assert((await r.json()).errorCode === 'handoff_already_redeemed')
    pass(
      'Meeting: Buyer real QR -> actual decoder -> Seller API; both sessions Protection; 24h; replay and both-channel redemption fenced'
    )
    await bp.close()
    await sp.close()
    const manualCredential = ok(
      await h.clients[1].rpc('marketplace_handoff_credential', {
        p_order_id: manual.order.id,
      })
    )
    const qa = await post(buyer, manual.order.id, 'generate-qr', {
      clientActionId: uuid(),
    })
    assert(qa.ok())
    const oldQr = await qa.json()
    const qb = await post(buyer, manual.order.id, 'generate-qr', {
      clientActionId: uuid(),
    })
    assert(qb.ok())
    const newQr = await qb.json()
    assert(
      oldQr.qrToken !== newQr.qrToken &&
        Date.parse(newQr.expiresAt) - Date.parse(newQr.serverTime) <= 60000
    )
    r = await post(seller, manual.order.id, 'handoff', {
      channel: 'qr',
      credential: oldQr.qrToken,
      clientActionId: uuid(),
    })
    assert.equal((await r.json()).errorCode, 'invalid_handoff_credential')
    manualCredential.qrToken = newQr.qrToken
    pass(
      'Real QR rotation: A invalid immediately, B current; server-provided 60-second deadline'
    )
    await new Promise((resolve) => setTimeout(resolve, 61000))
    r = await post(seller, manual.order.id, 'handoff', {
      channel: 'qr',
      credential: newQr.qrToken,
      clientActionId: uuid(),
    })
    assert.equal((await r.json()).errorCode, 'qr_expired')
    const sameCode = ok(
      await h.clients[1].rpc('marketplace_handoff_credential', {
        p_order_id: manual.order.id,
      })
    )
    assert.equal(sameCode.code, manualCredential.code)
    pass(
      'Real server time elapsed beyond QR TTL: expired QR rejected; numeric fallback unchanged'
    )
    const qc = await post(buyer, manual.order.id, 'generate-qr', {
      clientActionId: uuid(),
    })
    assert(qc.ok())
    manualCredential.qrToken = (await qc.json()).qrToken
    r = await post(seller, manual.order.id, 'handoff', {
      ...successfulBody,
      clientActionId: uuid(),
    })
    assert(
      (await r.json()).errorCode === 'invalid_handoff_credential',
      'Wrong Order token rejected'
    )
    const wrong = await h.clients[2].rpc('marketplace_verify_handoff', {
      p_order_id: manual.order.id,
      p_channel: 'qr',
      p_credential: manualCredential.qrToken,
      p_client_action_id: uuid(),
    })
    assert(wrong.error?.code === '42501', 'Wrong Seller rejected')
    sp = await open(seller, manual, 'seller', 1280)
    await sp.getByRole('tab', { name: 'Enter code', exact: true }).click()
    await sp.getByLabel('Buyer handoff code').fill(manualCredential.code)
    await sp
      .getByRole('button', { name: 'Verify handoff', exact: true })
      .click()
    await sp
      .locator('[data-current-step="protection"]')
      .waitFor({ timeout: 30000 })
    r = await post(seller, manual.order.id, 'handoff', {
      channel: 'qr',
      credential: manualCredential.qrToken,
      clientActionId: uuid(),
    })
    assert((await r.json()).errorCode === 'handoff_already_redeemed')
    pass(
      'Separate real numeric fallback succeeds; QR subsequently rejected; wrong Order and wrong Seller rejected'
    )
    await sp.close()
    sp = await open(seller, deliveryOrder, 'seller', 430)
    assert(
      await sp
        .getByRole('button', { name: 'Start delivery', exact: true })
        .isVisible()
    )
    assert(
      (await sp
        .getByRole('button', { name: 'Open scanner', exact: true })
        .count()) === 0
    )
    await sp
      .getByRole('button', { name: 'Start delivery', exact: true })
      .click()
    await sp
      .getByRole('button', { name: 'Open scanner', exact: true })
      .waitFor()
    const dc = ok(
      await h.clients[1].rpc('marketplace_handoff_credential', {
        p_order_id: deliveryOrder.order.id,
      })
    )
    const dq = await post(buyer, deliveryOrder.order.id, 'generate-qr', {
      clientActionId: uuid(),
    })
    assert(dq.ok())
    dc.qrToken = (await dq.json()).qrToken
    const orderId = h.q(deliveryOrder.order.id),
      buyerId = h.q(h.users[1]),
      sellerId = h.q(h.users[0])
    await h.query(
      `begin;select set_config('request.jwt.claims',jsonb_build_object('sub',${buyerId},'role','authenticated')::text,true);select public.marketplace_request_delivery_full_refund(${orderId},'seller_fault','Synthetic rollback hold',gen_random_uuid());select set_config('request.jwt.claims',jsonb_build_object('sub',${sellerId},'role','authenticated')::text,true);select public.marketplace_respond_delivery_cancellation(${orderId},'dispute',gen_random_uuid());do $$begin begin perform public.marketplace_verify_handoff(${orderId},'qr',repeat('a',64),gen_random_uuid());raise exception 'Hold bypass';exception when unique_violation then null;end;end$$;rollback;select true as hold_rejected;`
    )
    const bad = dc.code === '000000' ? '000001' : '000000'
    for (let i = 0; i < 5; i++) {
      r = await post(seller, deliveryOrder.order.id, 'handoff', {
        channel: 'code',
        credential: bad,
        clientActionId: uuid(),
      })
      assert((await r.json()).errorCode === 'invalid_handoff_credential')
    }
    r = await post(seller, deliveryOrder.order.id, 'handoff', {
      channel: 'code',
      credential: dc.code,
      clientActionId: uuid(),
    })
    const lock = await r.json()
    assert(
      lock.errorCode === 'numeric_temporarily_locked' &&
        Number.isFinite(Date.parse(lock.retryAt))
    )
    bp = await open(buyer, deliveryOrder, 'buyer', 430)
    assert.equal(await bp.getByRole('img', { name: /Handoff QR/ }).count(), 0)
    await bp
      .getByRole('button', { name: 'Generate QR code', exact: true })
      .click()
    await bp.getByRole('img', { name: /Handoff QR/ }).waitFor()
    await scan(bp, sp)
    await bp
      .locator('[data-current-step="protection"]')
      .waitFor({ timeout: 30000 })
    pass(
      'Seller Delivery: Start required; rollback Case hold rejects; numeric lock/retryAt authoritative; QR still succeeds after Start'
    )
    await bp.close()
    await sp.close()
    for (const [context, role] of [
      [buyer, 'buyer'],
      [seller, 'seller'],
    ]) {
      const p = await open(context, courier, role, 820)
      assert((await p.getByRole('img', { name: /Handoff QR/ }).count()) === 0)
      assert(
        (await p
          .getByRole('button', { name: 'Open scanner', exact: true })
          .count()) === 0
      )
      assert((await p.getByLabel('Buyer handoff code').count()) === 0)
      await p.close()
    }
    r = await seller.request.post(
      base + '/api/orders/' + courier.order.id + '/cancel',
      {
        headers: { Origin: base, 'X-Marketplace-Request': '1' },
        data: {
          reason: 'seller_scheduling_issue',
          note: 'Disposable qualification',
          clientActionId: uuid(),
        },
      }
    )
    assert(r.ok(), 'Synthetic Courier cancellation')
    r = await post(seller, courier.order.id, 'handoff', {
      channel: 'qr',
      credential: dc.qrToken,
      clientActionId: uuid(),
    })
    assert(!r.ok(), 'Cancelled Order rejects handoff')
    pass('Courier excludes all handoff UI; cancelled Order cannot handoff')
    for (const id of [
      meeting.order.id,
      manual.order.id,
      deliveryOrder.order.id,
    ]) {
      const rows = await h.query(
        'begin read only;select event_type,count(*) n from public.transaction_events where order_id=' +
          h.q(id) +
          " and event_type in('handoff_confirmed','protection_started') group by event_type;rollback;"
      )
      assert(
        rows.length === 2 && rows.every((r) => Number(r.n) === 1),
        'Exactly one handoff and Protection event'
      )
    }
    pass(
      'Event cardinality: one handoff + one Protection start per successful Order'
    )
  } finally {
    for (const c of contexts) await c.close()
    if (browser) await browser.close()
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      baseline,
      'Canonical/manual/D1 baseline unchanged'
    )
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('.env.local'))
        .digest('hex'),
      envHash
    )
    if (fs.existsSync(fixtureRoot + '/scope.json'))
      fs.unlinkSync(fixtureRoot + '/scope.json')
    pass(
      'Synthetic graph/Auth/media cleanup verified; original data and .env.local unchanged'
    )
  }
}
const task = recovery
  ? h.recover().then(() => {
      fs.unlinkSync(fixtureRoot + '/scope.json')
      pass('Exact QR journal recovery complete')
    })
  : run()
task.catch((e) => {
  console.error(
    'Staging handoff qualification failed: ' +
      e.message
        .replace(/[0-9a-f]{64}/g, '[redacted]')
        .replace(/\b[0-9]{6}\b/g, '[redacted-code]')
  )
  console.error(
    String(e.stack)
      .split('\n')
      .filter((line) => /at .*\.cjs:[0-9]+/.test(line))
      .slice(0, 2)
      .join('\n')
  )
  process.exitCode = 1
})
