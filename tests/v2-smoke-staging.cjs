// Hosted staging qualification. Never uses canonical transactions or a linked default target.
const fs = require('node:fs')
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const { spawnSync } = require('node:child_process')
assert(
  !fs.existsSync('tests/artifacts/meetup-d1-fixtures/scope.json'),
  'Unfinished fixture journal: stop; do not overwrite or recover automatically'
)
const h = require('./order-meetup-fixtures.cjs')
const uuid = () => crypto.randomUUID()
const ok = (r) => {
  assert(!r.error, r.error?.code || 'Staging transport failure')
  return r.data
}
const row = async (sql) => (await h.query(sql))[0]
const checks = []
const pass = (name) => {
  checks.push(name)
  console.log('PASS ' + name)
}
const envHash = () =>
  crypto
    .createHash('sha256')
    .update(fs.readFileSync('.env.local'))
    .digest('hex')
async function confirm(f, who = 1) {
  const cmd = uuid(),
    batch = await h.prepare(f, cmd, who)
  return ok(await h.accept(f, batch, cmd, who))
}
async function expire(order, listing) {
  await h.query(`begin;lock table public.order_meetup_revisions in access exclusive mode;
alter table public.order_meetup_revisions disable trigger order_meetup_guard;
alter table public.order_meetup_revisions disable trigger order_meetup_event;
update public.order_meetup_revisions set scheduled_at=date_trunc('hour',clock_timestamp())-interval '2 hours' where order_id=${h.q(
    order
  )} and status='confirmed';
alter table public.order_meetup_revisions enable trigger order_meetup_event;
alter table public.order_meetup_revisions enable trigger order_meetup_guard;
select marketplace_private.settle_order_meetup(${h.q(listing)});commit;`)
}
async function concurrentConfirm(first) {
  const f = await h.fixture()
  const seller = await row(
    `select conversation_id,offer_terms from public.order_requests where id=${h.q(
      f.offer
    )}`
  )
  const buyer = ok(
    await h.clients[1].rpc('marketplace_submit_offer', {
      p_conversation_id: seller.conversation_id,
      p_terms: seller.offer_terms,
      p_client_action_id: uuid(),
      p_comparison_offer_id: f.offer,
      p_kind: 'counter',
    })
  )
  h.offers.push(buyer.id)
  h.journal()
  const commands = [uuid(), uuid()]
  const batches = [
    await h.prepare(f, commands[0], 1),
    await h.prepare({ ...f, offer: buyer.id }, commands[1], 0),
  ]
  const inputs = [
    {
      user: h.users[1],
      offer: f.offer,
      batch: batches[0].id,
      cmd: commands[0],
    },
    {
      user: h.users[0],
      offer: buyer.id,
      batch: batches[1].id,
      cmd: commands[1],
    },
  ]
  const tag = 'smoke_' + uuid().replaceAll('-', '')
  const tx = (i, hold) => `begin;set local application_name=${h.q(
    tag + (hold ? 'a' : 'b')
  )};set local lock_timeout='35s';select set_config('request.jwt.claims',${h.q(
    JSON.stringify({ sub: inputs[i].user, role: 'authenticated' })
  )},true);
do $$begin perform set_config('smoke.result','success',true);begin perform public.marketplace_accept_offer(${h.q(
    inputs[i].offer
  )},${h.q(inputs[i].cmd)},${h.q(
    inputs[i].batch
  )});exception when check_violation or unique_violation then perform set_config('smoke.result',sqlstate,true);end;end$$;
${
  hold ? 'select pg_sleep(18);' : ''
}select current_setting('smoke.result') result,pg_backend_pid() pid,txid_current() xid;commit;`
  const a = h.query(tx(first, true))
  a.catch(() => {})
  let asleep = false
  for (let i = 0; i < 10; i++) {
    const r = await row(
      `select wait_event from pg_stat_activity where application_name=${h.q(
        tag + 'a'
      )}`
    )
    if (r?.wait_event === 'PgSleep') {
      asleep = true
      break
    }
  }
  assert(asleep, 'Winner must hold transaction locks before competitor starts')
  const b = h.query(tx(1 - first, false))
  b.catch(() => {})
  let blocked = false
  for (let i = 0; i < 10; i++) {
    const r = await row(
      `select wait_event_type,cardinality(pg_blocking_pids(pid)) blockers from pg_stat_activity where application_name=${h.q(
        tag + 'b'
      )}`
    )
    if (r?.wait_event_type === 'Lock' && r.blockers > 0) {
      blocked = true
      break
    }
  }
  const results = (await Promise.all([a, b])).map((rows) =>
    rows.find((r) => 'result' in r)
  )
  assert(
    blocked,
    'Independent Confirm transactions must overlap at a lock barrier'
  )
  assert.notEqual(results[0].pid, results[1].pid)
  assert.notEqual(results[0].xid, results[1].xid)
  assert.equal(results.filter((r) => r.result === 'success').length, 1)
  const facts = await row(
    `select count(*) orders,count(*) filter(where holds_listing) holders from public.orders where listing_id=${h.q(
      f.lid
    )}`
  )
  assert.equal(Number(facts.orders), 1)
  assert.equal(Number(facts.holders), 1)
  const statuses = await row(
    `select count(*) filter(where status='accepted') accepted,count(*) filter(where status='closed') closed from public.order_requests where listing_id=${h.q(
      f.lid
    )}`
  )
  assert.equal(Number(statuses.accepted), 1)
  assert.equal(Number(statuses.closed), 1)
  pass(
    'concurrent Confirm: ' +
      (first === 0 ? 'Buyer' : 'Seller') +
      ' wins; independent transactions, observed lock overlap, one Order'
  )
}
async function run() {
  const originalEnv = envHash(),
    baseline = await h.fingerprint()
  fs.writeFileSync(
    require('node:path').join(h.root, 'qualification-baseline.json'),
    JSON.stringify(baseline)
  )
  try {
    // Rollback-only SQL covers dual sender/replacement/Deny, withdrawal boundaries,
    // tombstones, eligibility and frozen item-only economics, using fresh UUIDs.
    const r = spawnSync(
      process.execPath,
      ['tests/offer-revision-staging.cjs', '--deployed'],
      { stdio: 'inherit', env: process.env, windowsHide: true }
    )
    assert.equal(r.status, 0, 'Deployed rollback qualification')
    pass(
      'dual Active, same-sender Revise, Deny, 5-minute withdrawal/tombstones, fee rule (rollback)'
    )
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    const baselineListing = await h.fixture('on_campus', false)
    const l = await row(
      `select price_cents,preferred_fulfillment from public.listings where id=${h.q(
        baselineListing.lid
      )}`
    )
    assert.equal(l.preferred_fulfillment, 'ON_CAMPUS')
    const initial = ok(
      await h.clients[1].rpc('marketplace_submit_offer', {
        p_conversation_id: baselineListing.conversationId,
        p_terms: {
          item_amount_cents: Number(l.price_cents),
          fulfillment: 'on_campus',
          meetup_location: 'Synthetic baseline campus',
          scheduled_at: new Date(
            Math.ceil((Date.now() + 6 * 3600000) / 900000) * 900000
          ).toISOString(),
        },
        p_client_action_id: uuid(),
      })
    )
    h.offers.push(initial.id)
    h.journal()
    assert.equal(
      Number(initial.offer_terms.item_amount_cents),
      Number(l.price_cents)
    )
    assert.equal(initial.offer_terms.fulfillment, 'on_campus')
    const editor = fs.readFileSync('components/home/offer-ui.tsx', 'utf8')
    assert(
      editor.includes('listing.live?.preferredFulfillment') &&
        editor.includes('listing.live?.price ?? listing.price')
    )
    pass(
      'Listing baseline: authoritative ON_CAMPUS default; editor uses live preference and asking price'
    )
    const sellerCounter = ok(
      await h.clients[0].rpc('marketplace_submit_offer', {
        p_conversation_id: baselineListing.conversationId,
        p_terms: { ...initial.offer_terms, item_amount_cents: 8100 },
        p_client_action_id: uuid(),
        p_comparison_offer_id: initial.id,
        p_kind: 'counter',
      })
    )
    h.offers.push(sellerCounter.id)
    h.journal()
    assert.equal(
      (
        await row(
          `select count(*) count from public.order_requests where conversation_id=${h.q(
            baselineListing.conversationId
          )} and status='active'`
        )
      ).count,
      2
    )
    const buyerRevise = ok(
      await h.clients[1].rpc('marketplace_submit_offer', {
        p_conversation_id: baselineListing.conversationId,
        p_terms: { ...initial.offer_terms, item_amount_cents: 8050 },
        p_client_action_id: uuid(),
        p_comparison_offer_id: initial.id,
        p_kind: 'revise',
      })
    )
    h.offers.push(buyerRevise.id)
    h.journal()
    assert.equal(
      (
        await row(
          `select status from public.order_requests where id=${h.q(initial.id)}`
        )
      ).status,
      'superseded'
    )
    assert.equal(
      (
        await row(
          `select status from public.order_requests where id=${h.q(
            sellerCounter.id
          )}`
        )
      ).status,
      'active'
    )
    ok(
      await h.clients[1].rpc('marketplace_deny_offer', {
        p_offer_id: sellerCounter.id,
        p_client_action_id: uuid(),
      })
    )
    assert.equal(
      (
        await row(
          `select status from public.order_requests where id=${h.q(
            sellerCounter.id
          )}`
        )
      ).status,
      'declined'
    )
    assert.equal(
      (
        await row(
          `select status from public.order_requests where id=${h.q(
            buyerRevise.id
          )}`
        )
      ).status,
      'active'
    )
    ok(
      await h.clients[1].rpc('marketplace_withdraw_offer', {
        p_offer_id: buyerRevise.id,
        p_client_action_id: uuid(),
      })
    )
    assert.equal(
      (
        await row(
          `select status from public.order_requests where id=${h.q(
            buyerRevise.id
          )}`
        )
      ).status,
      'withdrawn'
    )
    const message = ok(
      await h.clients[1].rpc('marketplace_send_text', {
        p_conversation_id: baselineListing.conversationId,
        p_client_message_id: uuid(),
        p_content: 'Disposable withdrawal smoke',
      })
    )
    const tombstone = ok(
      await h.clients[1].rpc('marketplace_withdraw_message', {
        p_message_id: message.id,
      })
    )
    assert(tombstone.withdrawn_at && tombstone.content === null)
    pass(
      'real Buyer Revise preserves Seller Active; recipient Deny preserves own Active; committed Offer/Message withdrawal tombstones'
    )
    for (const first of [0, 1]) await concurrentConfirm(first)
    const f = await h.fixture()
    const order = await confirm(f)
    assert.equal(
      (await row(`select status from public.listings where id=${h.q(f.lid)}`))
        .status,
      'pending'
    )
    assert.equal(
      (
        await row(
          `select status from public.order_requests where id=${h.q(f.offer)}`
        )
      ).status,
      'accepted'
    )
    const history = ok(
      await h.clients[1].rpc('marketplace_offer_history', {
        p_conversation_id: order.conversation_id,
      })
    )
    assert(history.agreements.some((a) => a.id === order.id))
    pass('Confirm: Accepted, independent Agreement, Listing Pending')
    ok(
      await h.clients[1].rpc('marketplace_cancel_order', {
        p_order_id: order.id,
        p_reason: 'buyer_changed_mind',
        p_note: 'Isolated maintenance smoke',
        p_client_action_id: uuid(),
      })
    )
    assert.equal(
      (
        await row(
          `select lifecycle_status from public.orders where id=${h.q(order.id)}`
        )
      ).lifecycle_status,
      'cancelled'
    )
    pass('Agreement Cancelled')
    const expired = await h.accepted()
    await expire(expired.order.id, expired.lid)
    assert.equal(
      (
        await row(
          `select lifecycle_status from public.orders where id=${h.q(
            expired.order.id
          )}`
        )
      ).lifecycle_status,
      'expired'
    )
    pass('Agreement Expired through authoritative settlement')
    const complete = await h.accepted()
    ok(
      await h.clients[1].rpc('marketplace_confirm_campus_inspection', {
        p_order_id: complete.order.id,
        p_client_action_id: uuid(),
      })
    )
    const payment = ok(
      await h.clients[1].rpc('marketplace_start_order_payment', {
        p_order_id: complete.order.id,
        p_client_action_id: uuid(),
      })
    )
    ok(
      await h.admin.rpc('marketplace_resolve_campus_payment', {
        p_attempt_id: payment.attemptId,
        p_success: true,
      })
    )
    const credential = ok(
      await h.clients[1].rpc('marketplace_handoff_credential', {
        p_order_id: complete.order.id,
      })
    )
    ok(
      await h.clients[0].rpc('marketplace_verify_handoff', {
        p_order_id: complete.order.id,
        p_channel: 'qr',
        p_credential: credential.qrToken,
        p_client_action_id: uuid(),
      })
    )
    await h.query(
      `begin;update marketplace_private.order_protection set started_at=t.v-interval '25 hours',expires_at=t.v-interval '1 hour' from(select clock_timestamp() v)t where order_id=${h.q(
        complete.order.id
      )};select marketplace_private.settle_order_protection(${h.q(
        complete.lid
      )});commit;`
    )
    const facts = await row(
      `select o.lifecycle_status,o.payment_status,l.status listing from public.orders o join public.listings l on l.id=o.listing_id where o.id=${h.q(
        complete.order.id
      )}`
    )
    assert.deepEqual(facts, {
      lifecycle_status: 'completed',
      payment_status: 'paid',
      listing: 'sold',
    })
    pass(
      'inspection -> staging Paid -> Buyer-held handoff -> Protection -> Completed/Sold'
    )
    const delivery = await h.fixture('delivery')
    const original = await row(
      `select conversation_id,offer_terms from public.order_requests where id=${h.q(
        delivery.offer
      )}`
    )
    const revised = ok(
      await h.clients[0].rpc('marketplace_submit_offer', {
        p_conversation_id: original.conversation_id,
        p_terms: { ...original.offer_terms, delivery_fee_cents: 1000 },
        p_comparison_offer_id: delivery.offer,
        p_kind: 'revise',
        p_client_action_id: uuid(),
      })
    )
    h.offers.push(revised.id)
    h.journal()
    delivery.offer = revised.id
    delivery.order = await confirm(delivery)
    const money = ok(
      await h.clients[1].rpc('marketplace_order_economics', {
        p_order_id: delivery.order.id,
      })
    )
    assert.equal(Number(money.fee), 75)
    assert.equal(Number(money.sellerFee), 0)
    const economics = await row(
      `select item_price_cents,delivery_fee_cents,buyer_total_cents from marketplace_private.v2_order_economics where order_id=${h.q(
        delivery.order.id
      )}`
    )
    assert.equal(Number(economics.delivery_fee_cents), 1000)
    assert.equal(Number(economics.buyer_total_cents), 8575)
    const fees = await row(
      'begin read only;select marketplace_private.v2_buyer_service_fee(1) tiny,marketplace_private.v2_buyer_service_fee(50) half_cent,marketplace_private.v2_buyer_service_fee(50000) cap,marketplace_private.v2_buyer_service_fee(90000) above_cap;rollback;'
    )
    assert.deepEqual(fees, { tiny: 0, half_cent: 1, cap: 500, above_cap: 500 })
    pass(
      'new Order 1% item-only economics / zero Seller fee; rounding/cap/Delivery exclusion regression'
    )
  } finally {
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      baseline,
      'Canonical/manual/Nike/D1 state changed'
    )
    assert.equal(envHash(), originalEnv, '.env.local changed')
  }
  console.log(
    JSON.stringify({
      project: 'pcaqxezdfxofysghssyo',
      passed: true,
      checks,
      cleanup: true,
      protectedFingerprintsUnchanged: true,
      productionContacted: false,
    })
  )
  // A successful run is independently repeatable; failed runs retain exact cleanup journals.
  for (const c of h.clients) c.auth.stopAutoRefresh()
  for (const name of fs.readdirSync(h.root))
    fs.unlinkSync(require('node:path').join(h.root, name))
  fs.rmdirSync(h.root)
}
run().catch((error) => {
  fs.writeFileSync(
    require('node:path').join(h.root, 'smoke-failure.json'),
    JSON.stringify({ message: error.message, stack: error.stack })
  )
  console.error(
    'V2 staging smoke failed; see ignored smoke-failure.json, exact fixture journal retained if needed'
  )
  process.exitCode = 1
})
