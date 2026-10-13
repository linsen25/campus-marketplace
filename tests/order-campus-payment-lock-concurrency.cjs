const fs = require('fs'),
  assert = require('assert/strict'),
  crypto = require('crypto')
const h = require('./order-meetup-fixtures.cjs'),
  { query, q, users, clients, report, root } = h
function identity(index) {
  return `select set_config('request.jwt.claims',${q(
    JSON.stringify({ sub: users[index], role: 'authenticated' })
  )},true);`
}
function acceptSql(f, b, cmd) {
  return `${identity(1)} perform public.marketplace_accept_offer(${q(
    f.offer
  )},${q(cmd)},${q(b.id)});`
}
// Identity SET is outside DO; only explicit domain rejections are captured, never deadlock/timeouts.
function tx(tag, identitySql, operation, sleep) {
  return `begin;set local application_name=${q(
    tag
  )};set local lock_timeout='55s';${identitySql}
 do $$begin perform set_config('d1.outcome','success',true);begin ${operation}
 exception when unique_violation or check_violation or insufficient_privilege or raise_exception then
 perform set_config('d1.outcome',sqlstate||':'||sqlerrm,true);end;end$$;
 ${
   sleep ? 'select pg_sleep(25);' : ''
 }select current_setting('d1.outcome') outcome;commit;`
}
async function race(first, second) {
  const tag = 'd2arace_' + crypto.randomUUID().replaceAll('-', '')
  const a = query(tx(tag, first.identity, first.op, true))
  // Attach rejection immediately; wait/lock inspection must never hide a failed transaction.
  a.catch(() => {})
  let sleeping = false
  for (let n = 0; n < 8; n++) {
    const rows = await query(
      `select wait_event from pg_stat_activity where application_name=${q(
        tag
      )};`
    )
    if (rows[0]?.wait_event === 'PgSleep') {
      sleeping = true
      break
    }
  }
  assert(sleeping, 'First independent transaction must hold its lock')
  const b = query(tx(tag + '_b', second.identity, second.op, false))
  b.catch(() => {})
  let blocked = false
  for (let n = 0; n < 8; n++) {
    const rows = await query(
      `select wait_event_type,cardinality(pg_blocking_pids(pid)) blockers from pg_stat_activity where application_name=${q(
        tag + '_b'
      )};`
    )
    if (rows[0]?.wait_event_type === 'Lock' && rows[0].blockers > 0) {
      blocked = true
      break
    }
  }
  assert(
    blocked,
    'Second independent transaction must actually overlap and block'
  )
  const results = await Promise.all([a, b])
  report.concurrentRuns++
  return results.map((rows) => rows.find((row) => 'outcome' in row)?.outcome)
}

const uuid = () => crypto.randomUUID()
const action = (f, name, key = uuid()) => ({
  identity: identity(1),
  op: `perform public.${name}(${q(f.order.id)},${q(key)});`,
})
async function age(f) {
  await query(
    `begin;lock table public.orders in access exclusive mode;alter table public.order_meetup_revisions disable trigger order_meetup_guard;alter table public.order_meetup_revisions disable trigger order_meetup_event;update public.order_meetup_revisions set scheduled_at=clock_timestamp()-interval '65 minutes' where order_id=${q(
      f.order.id
    )} and status='confirmed';alter table public.order_meetup_revisions enable trigger order_meetup_guard;alter table public.order_meetup_revisions enable trigger order_meetup_event;commit;`
  )
}
async function state(f) {
  return (
    await query(`select o.lifecycle_status life,o.payment_status payment,l.status listing,o.holds_listing held,r.status offer,
 (select count(*) from marketplace_private.campus_inspections where order_id=o.id) inspections,
 (select count(*) from marketplace_private.campus_payment_attempts where order_id=o.id) attempts,
 (select count(*) from public.transaction_events where order_id=o.id and event_type='buyer_inspection_confirmed') inspection_events,
 (select count(*) from public.transaction_events where order_id=o.id and event_type='payment_started') started_events,
 (select count(*) from public.transaction_events where order_id=o.id and event_type in('order_cancelled','order_no_show_expired')) terminal_events
 from public.orders o join public.listings l on l.id=o.listing_id join public.order_requests r on r.id=o.request_id where o.id=${q(
   f.order.id
 )};`)
  )[0]
}

async function reusedListing() {
  const f = await h.fixture('delivery')
  const cid = (
    await query(
      `select conversation_id from public.order_requests where id=${q(
        f.offer
      )};`
    )
  )[0].conversation_id
  assert(
    !(
      await clients[0].rpc('marketplace_withdraw_offer', {
        p_offer_id: f.offer,
        p_client_action_id: uuid(),
        p_note: 'Synthetic reuse',
      })
    ).error
  )
  const r = await clients[0].rpc('marketplace_create_order_request', {
    p_conversation_id: cid,
    p_terms: {
      item_amount_cents: 7000,
      fulfillment_type: 'shipping',
      shipping_cost_mode: 'included',
      shipping_amount_cents: 0,
    },
    p_client_action_id: uuid(),
  })
  assert(!r.error, r.error?.message)
  const a = await clients[1].rpc('marketplace_accept_order_request', {
    p_request_id: r.data.id,
    p_client_action_id: uuid(),
  })
  assert(!a.error, a.error?.message)
  h.orders.push(a.data.id)
  h.journal()
  const c = await clients[1].rpc('marketplace_cancel_order', {
    p_order_id: a.data.id,
    p_reason: 'buyer_changed_mind',
    p_note: 'Synthetic reuse',
    p_client_action_id: uuid(),
  })
  assert(!c.error, c.error?.message)
  const off = await clients[0].rpc('marketplace_create_offer', {
    p_conversation_id: cid,
    p_terms: {
      item_amount_cents: 7500,
      fulfillment: 'on_campus',
      meetup_location: 'Synthetic reused listing',
      scheduled_at: new Date(
        Math.ceil((Date.now() + 6 * 3600000) / 900000) * 900000
      ).toISOString(),
      note: '',
    },
    p_client_action_id: uuid(),
  })
  assert(!off.error, off.error?.message)
  f.offer = off.data.id
  h.offers.push(f.offer)
  h.journal()
  const b = await h.prepare(f),
    v2 = await h.accept(f, b)
  assert(!v2.error, v2.error?.message)
  return { ...f, order: v2.data, legacyOrder: a.data.id }
}
async function observe(tag, expected) {
  for (let n = 0; n < 8; n++) {
    const rows = await query(
      `select wait_event,wait_event_type,cardinality(pg_blocking_pids(pid)) blockers from pg_stat_activity where application_name=${q(
        tag
      )};`
    )
    if (expected === 'sleep' && rows[0]?.wait_event === 'PgSleep') return
    if (
      expected === 'lock' &&
      rows[0]?.wait_event_type === 'Lock' &&
      rows[0].blockers > 0
    )
      return
  }
  throw Error('Real concurrency barrier not observed: ' + expected)
}
;(async () => {
  const baseline = await h.fingerprint()
  let failure
  try {
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    for (const reverse of [false, true]) {
      const f = await reusedListing()
      assert(
        !(
          await clients[1].rpc('marketplace_confirm_campus_inspection', {
            p_order_id: f.order.id,
            p_client_action_id: uuid(),
          })
        ).error
      )
      const payment = action(f, 'marketplace_start_campus_payment')
      const legacy = {
        identity: `select set_config('request.jwt.claims',${q(
          JSON.stringify({ role: 'service_role', ref: 'pcaqxezdfxofysghssyo' })
        )},true);`,
        op: `if(public.marketplace_simulate_order_payment_success(${q(
          f.legacyOrder
        )},${q(users[1])},${q(
          uuid()
        )})->>'errorCode') is distinct from 'order_not_payment_ready' then raise exception 'Historical V1 retry must reject';end if;`,
      }
      if (!reverse) await race(payment, legacy)
      else {
        const tag = 'd2a_cap_row_' + uuid().replaceAll('-', '')
        const barrier = query(
          `begin;set local application_name=${q(
            tag
          )};select user_id from marketplace_private.financial_capabilities where user_id=${q(
            users[1]
          )} and capability='payment_method' for update;select pg_sleep(25);commit;`
        )
        barrier.catch(() => {})
        await observe(tag, 'sleep')
        const old = query(tx(tag + '_old', legacy.identity, legacy.op, false))
        old.catch(() => {})
        await observe(tag + '_old', 'lock')
        const current = query(
          tx(tag + '_new', payment.identity, payment.op, false)
        )
        current.catch(() => {})
        await observe(tag + '_new', 'lock')
        await Promise.all([barrier, old, current])
        report.concurrentRuns++
      }
      const s = await state(f)
      assert.equal(s.life, 'open')
      assert.equal(s.payment, 'processing')
      assert.equal(s.listing, 'pending')
      assert.equal(
        (
          await query(
            `select lifecycle_status life from public.orders where id=${q(
              f.legacyOrder
            )};`
          )
        )[0].life,
        'cancelled'
      )
      h.passed(
        'historical V1 retry / V2 payment ' +
          (reverse ? 'legacy capability-lock-first' : 'V2 payment-first') +
          ' without deadlock'
      )
    }
    for (const kind of ['cancel', 'expiry'])
      for (const reverse of [false, true]) {
        const f = await h.accepted()
        assert(
          !(
            await clients[1].rpc('marketplace_confirm_campus_inspection', {
              p_order_id: f.order.id,
              p_client_action_id: uuid(),
            })
          ).error
        )
        if (kind === 'expiry') await age(f)
        const pay = action(f, 'marketplace_start_campus_payment')
        const terminal =
          kind === 'expiry'
            ? {
                identity: '',
                op: `perform marketplace_private.settle_order_meetup(${q(
                  f.lid
                )});`,
              }
            : {
                identity: identity(1),
                op: `if(public.marketplace_cancel_order(${q(
                  f.order.id
                )},'buyer_changed_mind','Synthetic final lock',${q(
                  uuid()
                )})->>'errorCode') is not null then raise exception 'Terminal rejected' using errcode='23505';end if;`,
              }
        await race(reverse ? terminal : pay, reverse ? pay : terminal)
        let s = await state(f)
        assert.equal(
          s.life,
          reverse ? (kind === 'expiry' ? 'expired' : 'cancelled') : 'open'
        )
        assert.equal(s.listing, reverse ? 'available' : 'pending')
        assert.equal(s.attempts, reverse ? 0 : 1)
        if (!reverse) {
          const row = (
            await query(
              `select id from marketplace_private.campus_payment_attempts where order_id=${q(
                f.order.id
              )};`
            )
          )[0]
          const paid = await h.admin.rpc('marketplace_resolve_campus_payment', {
            p_attempt_id: row.id,
            p_success: true,
          })
          assert(!paid.error, paid.error?.message)
          s = await state(f)
          assert.equal(s.payment, 'paid')
          assert.equal(s.life, 'open')
          assert.equal(s.listing, 'pending')
        }
        h.passed(
          'final lock payment / ' +
            kind +
            ' ' +
            (reverse ? 'terminal-first' : 'payment-first')
        )
      }
  } catch (e) {
    failure = e
  } finally {
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), baseline)
    fs.writeFileSync(
      root + '/d2a-final-lock-report.json',
      JSON.stringify(report)
    )
  }
  if (failure) throw failure
  console.log(
    JSON.stringify({
      ...report,
      canonicalUnchanged: true,
      syntheticCleanup: true,
    })
  )
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
