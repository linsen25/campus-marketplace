const fs = require('fs'),
  assert = require('assert/strict'),
  crypto = require('crypto')
const h = require('./order-meetup-fixtures.cjs')
const { clients, query, q } = h
const next = (hours = 8) =>
  new Date(
    Math.ceil((Date.now() + hours * 3600000) / 900000) * 900000
  ).toISOString()
const terms = (location = 'Synthetic campus cafe') => ({
  location,
  scheduled_at: next(),
  note: 'Meet near the public entrance',
})
async function action(
  f,
  who,
  kind,
  revision = null,
  t = null,
  key = crypto.randomUUID()
) {
  return clients[who].rpc('marketplace_order_meetup_action', {
    p_order_id: f.order.id,
    p_action: kind,
    p_revision_id: revision,
    p_terms: t,
    p_client_action_id: key,
  })
}
async function history(f, who = 1) {
  const r = await clients[who].rpc('marketplace_order_meetup_history', {
    p_order_id: f.order.id,
  })
  assert(!r.error, r.error?.message)
  return r.data
}
const current = (data) =>
  data.revisions.filter((r) => r.status === 'confirmed').at(-1)
async function economic(f) {
  return (
    await query(
      `select md5((to_jsonb(o)-array['updated_at','lifecycle_status','holds_listing','expired_at','reservation_ended_at','cancelled_at','cancelled_by','cancelled_by_role','cancel_reason_code','cancel_reason_label_snapshot','cancel_note'])::text) hash,(select md5(coalesce(string_agg(to_jsonb(m)::text,'' order by m.position),'')) from marketplace_private.order_snapshot_media m where m.order_id=o.id) media from public.orders o where o.id=${q(
        f.order.id
      )};`
    )
  )[0]
}
async function age(f, interval) {
  await query(
    `begin;lock table public.orders in access exclusive mode;alter table public.order_meetup_revisions disable trigger order_meetup_guard;alter table public.order_meetup_revisions disable trigger order_meetup_event;update public.order_meetup_revisions set scheduled_at=clock_timestamp()-interval ${q(
      interval
    )} where order_id=${q(
      f.order.id
    )} and status='confirmed';alter table public.order_meetup_revisions enable trigger order_meetup_event;alter table public.order_meetup_revisions enable trigger order_meetup_guard;commit;`
  )
}
async function settleFacts(f) {
  return (
    await query(
      `select o.lifecycle_status,o.holds_listing,l.status listing,r.status offer,(select count(*) from marketplace_private.meetup_expiries e where e.order_id=o.id) receipts,(select count(*) from public.transaction_events e where e.order_id=o.id and event_type='order_no_show_expired') events from public.orders o join public.listings l on l.id=o.listing_id join public.order_requests r on r.id=o.request_id where o.id=${q(
        f.order.id
      )};`
    )
  )[0]
}
;(async () => {
  const before = await h.fingerprint()
  let failed
  const passed = []
  try {
    await h.setup()
    const f = await h.accepted()
    const original = await history(f),
      initial = current(original),
      econ = await economic(f)
    assert.equal(original.revisions.length, 1)
    assert.equal(initial.revision, 0)
    assert.equal(initial.location, f.order.terms_snapshot.terms.meetup_location)
    assert.equal(
      Date.parse(initial.scheduled_at),
      Date.parse(f.order.terms_snapshot.terms.scheduled_at)
    )
    assert.equal(f.order.reservation_expires_at, null)
    assert((await action(f, 3, 'propose', null, terms())).error)
    assert(
      (
        await clients[3]
          .from('order_meetup_revisions')
          .select('*')
          .eq('order_id', f.order.id)
      ).data.length === 0
    )
    assert(
      (
        await clients[1]
          .from('order_meetup_revisions')
          .update({ location: 'Forbidden' })
          .eq('id', initial.id)
      ).error
    )
    for (const bad of [
      { ...terms(), item_amount_cents: 1 },
      { ...terms(), fulfillment: 'delivery' },
      { ...terms(), scheduled_at: '2030-01-01T10:00:00Z' },
      { ...terms(), scheduled_at: new Date().toISOString() },
      { ...terms(), scheduled_at: '2026-10-13 10:00:00' },
      { ...terms(), location: '' },
    ])
      assert((await action(f, 1, 'propose', null, bad)).error)
    const key = crypto.randomUUID(),
      input = terms()
    let a = await action(f, 1, 'propose', null, input, key)
    assert(!a.error, a.error?.message)
    const aid = a.data.revisionId
    assert.equal(
      (await action(f, 1, 'propose', null, input, key)).data.revisionId,
      aid
    )
    assert((await action(f, 1, 'propose', null, terms('Changed'), key)).error)
    assert.equal(current(await history(f)).id, initial.id)
    assert((await action(f, 1, 'confirm', aid)).error)
    assert((await action(f, 3, 'confirm', aid)).error)
    let d = await action(f, 0, 'decline', aid)
    assert(!d.error, d.error?.message)
    assert.equal(current(await history(f)).id, initial.id)
    a = await action(f, 0, 'propose', null, terms())
    assert(!a.error, a.error?.message)
    const sid = a.data.revisionId
    assert((await action(f, 0, 'confirm', sid)).error)
    const confirmKey = crypto.randomUUID()
    let confirmed = await action(f, 1, 'confirm', sid, null, confirmKey)
    assert(!confirmed.error, confirmed.error?.message)
    assert.equal(
      (await action(f, 1, 'confirm', sid, null, confirmKey)).data.revisionId,
      sid
    )
    assert.equal(current(await history(f)).id, sid)
    let x = await action(f, 1, 'propose', null, terms('Revision A'))
    assert(!x.error)
    let y = await action(f, 1, 'propose', null, terms('Revision B'))
    assert(!y.error)
    assert((await action(f, 0, 'confirm', x.data.revisionId)).error)
    let hs = await history(f)
    assert.equal(hs.revisions.filter((r) => r.status === 'pending').length, 1)
    assert.equal(
      hs.revisions.find((r) => r.id === x.data.revisionId).status,
      'superseded'
    )
    assert.equal(current(hs).id, sid)
    assert(!(await action(f, 1, 'withdraw', y.data.revisionId)).error)
    assert.deepEqual(await economic(f), econ)
    passed.push(
      'initial-exact-snapshot-Buyer-Seller-propose-other-confirm-decline-withdraw-replace-idempotency-stale-confirm-security-economics'
    )
    const exp = await h.accepted()
    const prop = await action(exp, 1, 'propose', null, terms())
    assert(!prop.error)
    // Test-only exact synthetic revision time shift, not a host clock/RPC clock override.
    await age(exp, '65 minutes')
    await query(
      `select marketplace_private.settle_order_meetup(${q(
        exp.lid
      )});select marketplace_private.settle_order_meetup(${q(exp.lid)});`
    )
    let facts = await settleFacts(exp)
    assert.equal(facts.lifecycle_status, 'expired')
    assert.equal(facts.listing, 'available')
    assert.equal(facts.offer, 'accepted')
    assert.equal(facts.receipts, 1)
    assert.equal(facts.events, 1)
    for (const kind of ['propose', 'confirm', 'decline', 'withdraw'])
      assert(
        (
          await action(
            exp,
            kind === 'propose' ? 1 : 0,
            kind,
            kind === 'propose' ? null : prop.data.revisionId,
            kind === 'propose' ? terms() : null
          )
        ).error
      )
    assert.equal(
      (await history(exp)).revisions.find((r) => r.id === prop.data.revisionId)
        .status,
      'closed'
    )
    const cancel = await clients[1].rpc('marketplace_cancel_order', {
      p_order_id: f.order.id,
      p_reason: 'buyer_changed_mind',
      p_note: 'Synthetic test',
      p_client_action_id: crypto.randomUUID(),
    })
    assert(!cancel.error)
    for (const kind of ['propose', 'confirm', 'decline', 'withdraw'])
      assert(
        (
          await action(
            f,
            kind === 'withdraw' ? 1 : 0,
            kind,
            kind === 'propose' ? null : initial.id,
            kind === 'propose' ? terms() : null
          )
        ).error
      )
    const boundary = await h.accepted()
    const bf = await economic(boundary)
    await query(
      `begin;lock table public.orders in access exclusive mode;alter table public.order_meetup_revisions disable trigger order_meetup_guard;alter table public.order_meetup_revisions disable trigger order_meetup_event;update public.order_meetup_revisions set scheduled_at=clock_timestamp()-interval '59 minutes 59 seconds' where order_id=${q(
        boundary.order.id
      )} and status='confirmed';alter table public.order_meetup_revisions enable trigger order_meetup_event;alter table public.order_meetup_revisions enable trigger order_meetup_guard;select marketplace_private.settle_order_meetup(${q(
        boundary.lid
      )});do $$begin if(select lifecycle_status from public.orders where id=${q(
        boundary.order.id
      )})<>'open' then raise exception 'Expired before 60m';end if;end$$;rollback;`
    )
    await age(boundary, '60 minutes')
    await query(
      `select marketplace_private.settle_order_meetup(${q(boundary.lid)});`
    )
    assert.equal((await settleFacts(boundary)).lifecycle_status, 'expired')
    assert.deepEqual(await economic(boundary), bf)
    const move = await h.accepted()
    let mp = await action(move, 1, 'propose', null, terms())
    assert(!mp.error)
    await age(move, '65 minutes')
    assert(!(await action(move, 0, 'confirm', mp.data.revisionId)).error)
    await query(
      `select marketplace_private.settle_order_meetup(${q(move.lid)});`
    )
    assert.equal((await settleFacts(move)).lifecycle_status, 'open')
    const delivery = await h.accepted('delivery')
    assert((await action(delivery, 1, 'propose', null, terms())).error)
    assert(
      (
        await clients[1].rpc('marketplace_order_meetup_history', {
          p_order_id: delivery.order.id,
        })
      ).error
    )
    await query(
      `select marketplace_private.settle_order_meetup(${q(delivery.lid)});`
    )
    assert.equal((await settleFacts(delivery)).lifecycle_status, 'open')
    passed.push(
      '59:59-open-60m-expired-idempotent-atomic-release-pending-no-extension-confirmed-new-deadline-terminal-history-retention-Delivery-isolation'
    )
    console.log('PASS ' + passed.join('\nPASS '))
  } catch (e) {
    failed = e
    console.error(e.stack)
  } finally {
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), before)
    fs.writeFileSync(
      h.root + '/domain-report.json',
      JSON.stringify({
        passed,
        syntheticCleanup: true,
        manualMediaFingerprintUnchanged: true,
      })
    )
    console.log(
      'Canonical/manual/media fingerprint unchanged; exact synthetic cleanup complete'
    )
  }
  if (failed) throw failed
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
