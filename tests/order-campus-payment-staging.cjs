const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const h = require('./order-meetup-fixtures.cjs')
const { query, q, clients, admin } = h
const uuid = () => crypto.randomUUID()
const inspect = (f, who = 1, key = uuid()) =>
  clients[who].rpc('marketplace_confirm_campus_inspection', {
    p_order_id: f.order.id,
    p_client_action_id: key,
  })
const start = (f, who = 1, key = uuid()) =>
  clients[who].rpc('marketplace_start_campus_payment', {
    p_order_id: f.order.id,
    p_client_action_id: key,
  })
const resolve = (id, success) =>
  admin.rpc('marketplace_resolve_campus_payment', {
    p_attempt_id: id,
    p_success: success,
  })
const cancel = (f, who = 1) =>
  clients[who].rpc('marketplace_cancel_order', {
    p_order_id: f.order.id,
    p_reason: who === 0 ? 'seller_scheduling_issue' : 'buyer_changed_mind',
    p_note: 'Synthetic D2A',
    p_client_action_id: uuid(),
  })
async function facts(f) {
  return (
    await query(`select o.payment_status payment,o.lifecycle_status life,o.holds_listing held,o.payment_paid_at paid_at,o.fulfillment_status fulfillment,o.payout_status payout,l.status listing,r.status offer,
  (select count(*) from marketplace_private.campus_inspections where order_id=o.id) inspections,
  (select count(*) from marketplace_private.campus_payment_attempts where order_id=o.id) attempts,
  (select count(*) from public.transaction_events where order_id=o.id and event_type='payment_paid') paid_events,
  (select count(*) from public.transaction_events where order_id=o.id and event_type='buyer_inspection_confirmed') inspection_events,
  (select count(*) from public.transaction_events where order_id=o.id and event_type='payment_failed') failed_events
  from public.orders o join public.listings l on l.id=o.listing_id join public.order_requests r on r.id=o.request_id where o.id=${q(
    f.order.id
  )};`)
  )[0]
}
async function immutable(f) {
  return (
    await query(`select md5((to_jsonb(o)-array['payment_status','payment_paid_at','fulfillment_status','updated_at','lifecycle_status','holds_listing','expired_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])::text) economics,
 (select md5(to_jsonb(r)::text) from public.order_requests r where r.id=o.request_id) offer,
 (select md5(string_agg(to_jsonb(r)::text,'' order by revision)) from public.order_meetup_revisions r where r.order_id=o.id) meetup,
 (select md5(string_agg(to_jsonb(m)::text,'' order by position)) from marketplace_private.order_snapshot_media m where m.order_id=o.id) media
 from public.orders o where o.id=${q(f.order.id)};`)
  )[0]
}
async function age(f) {
  await query(
    `begin;lock table public.orders in access exclusive mode;alter table public.order_meetup_revisions disable trigger order_meetup_guard;alter table public.order_meetup_revisions disable trigger order_meetup_event;update public.order_meetup_revisions set scheduled_at=clock_timestamp()-interval '65 minutes' where order_id=${q(
      f.order.id
    )} and status='confirmed';alter table public.order_meetup_revisions enable trigger order_meetup_guard;alter table public.order_meetup_revisions enable trigger order_meetup_event;commit;`
  )
}
const settle = (f) =>
  query(`select marketplace_private.settle_order_meetup(${q(f.lid)});`)
const ok = (r) => {
  assert(!r.error, r.error?.message)
  return r.data
}
async function run() {
  const baseline = await h.fingerprint()
  fs.writeFileSync(h.root + '/d2a-baseline.json', JSON.stringify(baseline))
  try {
    await h.setup()
    const f = await h.accepted('on_campus', true)
    const before = await immutable(f)
    assert((await start(f)).error)
    assert((await inspect(f, 0)).error)
    assert((await inspect(f, 3)).error)
    const key = uuid()
    ok(await inspect(f, 1, key))
    ok(await inspect(f, 1, key))
    ok(await inspect(f))
    assert.deepEqual(await immutable(f), before)
    let s = await facts(f)
    assert.equal(s.payment, 'pending')
    assert.equal(s.inspections, 1)
    assert.equal(s.inspection_events, 1)
    assert.equal(s.attempts, 0)
    h.passed(
      'Buyer-only idempotent inspection; no charge; immutable economics/Offer/meetup/private media'
    )
    assert.equal(ok(await start(f)).errorCode, 'buyer_payment_method_not_ready')
    await h.capability('needs_attention', 1, 'payment_method')
    assert.equal(ok(await start(f)).errorCode, 'buyer_payment_method_not_ready')
    await h.capability('set', 1, 'payment_method')
    assert((await start(f, 0)).error)
    assert((await start(f, 3)).error)
    const paymentKey = uuid()
    const a = ok(await start(f, 1, paymentKey))
    assert.equal(a.status, 'processing')
    const restart = ok(await start(f))
    assert.equal(restart.attemptId, a.attemptId)
    const replay = ok(await start(f, 1, paymentKey))
    assert.equal(replay.attemptId, a.attemptId)
    assert(
      (
        await clients[1].rpc('marketplace_resolve_campus_payment', {
          p_attempt_id: a.attemptId,
          p_success: true,
        })
      ).error
    )
    for (const who of [0, 1])
      assert.equal(ok(await cancel(f, who)).errorCode, 'order_not_cancellable')
    assert(
      (
        await clients[1]
          .from('orders')
          .update({ payment_status: 'paid' })
          .eq('id', f.order.id)
      ).error
    )
    await age(f)
    await settle(f)
    s = await facts(f)
    assert.equal(s.life, 'open')
    assert.equal(s.listing, 'pending')
    ok(await resolve(a.attemptId, false))
    ok(await resolve(a.attemptId, false))
    s = await facts(f)
    assert.equal(s.payment, 'failed')
    assert.equal(s.life, 'open')
    assert.equal(s.listing, 'pending')
    assert.equal(s.failed_events, 1)
    h.passed(
      'Unset/Needs attention gates only Pay; Processing protects inventory/Cancel/no-show; trusted Failed once'
    )
    const paymentSnapshot = await immutable(f)
    const retry = ok(await start(f))
    assert.notEqual(retry.attemptId, a.attemptId)
    ok(await resolve(retry.attemptId, true))
    ok(await resolve(retry.attemptId, true))
    s = await facts(f)
    assert.equal(s.payment, 'paid')
    assert.equal(s.life, 'open')
    assert.equal(s.listing, 'pending')
    assert.equal(s.payout, 'not_eligible')
    assert.equal(s.fulfillment, 'awaiting_fulfillment')
    assert.equal(s.paid_events, 1)
    assert.equal(s.attempts, 2)
    const paidAt = s.paid_at
    for (const who of [0, 1])
      assert.equal(ok(await cancel(f, who)).errorCode, 'order_not_cancellable')
    await settle(f)
    assert.equal((await facts(f)).paid_at, paidAt)
    const state = ok(
      await clients[0].rpc('marketplace_campus_payment_state', {
        p_order_id: f.order.id,
      })
    )
    assert.equal(state.itemCents, 7500)
    assert.equal(state.feeCents, 300)
    assert.equal(state.totalCents, 7800)
    assert(!JSON.stringify(state).includes('4242'))
    const after = await immutable(f)
    assert.deepEqual(after, paymentSnapshot)
    assert.equal(after.economics, before.economics)
    assert.equal(after.offer, before.offer)
    assert.equal(after.media, before.media)
    assert(
      (
        await clients[1].rpc('marketplace_order_meetup_action', {
          p_order_id: f.order.id,
          p_action: 'propose',
          p_revision_id: null,
          p_terms: {
            location: 'Synthetic',
            scheduled_at: new Date(Date.now() + 8 * 3600000).toISOString(),
            note: '',
          },
          p_client_action_id: uuid(),
        })
      ).error
    )
    h.passed(
      'Failed retry -> Paid once; Paid blocks both Cancels/no-show/reschedule; open/Pending/no payout/handoff/Protection'
    )
    for (const mode of ['inspection', 'failed']) {
      const g = await h.accepted()
      ok(await inspect(g))
      if (mode === 'failed') {
        const b = ok(await start(g))
        ok(await resolve(b.attemptId, false))
      }
      await age(g)
      await settle(g)
      assert.equal((await facts(g)).life, 'expired')
      assert.equal((await facts(g)).listing, 'available')
    }
    const g = await h.accepted()
    ok(await inspect(g))
    const b = ok(await start(g))
    ok(await resolve(b.attemptId, false))
    ok(await cancel(g))
    assert.equal((await facts(g)).life, 'cancelled')
    assert.equal((await facts(g)).listing, 'available')
    assert.equal((await facts(g)).offer, 'accepted')
    const d = await h.accepted('delivery')
    assert((await inspect(d)).error)
    assert((await start(d)).error)
    h.passed('Inspection-only/Failed expiry; Failed Cancel; Delivery isolated')
  } finally {
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), baseline)
    assert.equal(
      (
        await query(
          'select (select count(*) from marketplace_private.campus_inspections)+(select count(*) from marketplace_private.campus_payment_attempts) n;'
        )
      )[0].n,
      0
    )
  }
  h.passed(
    'Synthetic Auth/Orders/Offers/media/payment cleanup; canonical/manual fingerprints unchanged'
  )
}
run().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
