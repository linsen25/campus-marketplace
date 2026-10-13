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
;(async () => {
  const baseline = await h.fingerprint()
  let failure
  try {
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    for (const kind of [
      'payment_cancel',
      'payment_expiry',
      'inspection_cancel',
      'inspection_expiry',
      'duplicate_inspection',
      'duplicate_payment',
      'payment_cancel_repeat',
      'payment_expiry_repeat',
    ]) {
      for (const reverse of kind.startsWith('duplicate')
        ? [false]
        : [false, true]) {
        const f = await h.accepted()
        const inspection = action(f, 'marketplace_confirm_campus_inspection')
        if (kind.startsWith('payment') || kind === 'duplicate_payment')
          assert(
            !(
              await clients[1].rpc('marketplace_confirm_campus_inspection', {
                p_order_id: f.order.id,
                p_client_action_id: uuid(),
              })
            ).error
          )
        if (kind.includes('expiry')) await age(f)
        const payment = action(f, 'marketplace_start_campus_payment')
        const expiry = {
          identity: '',
          op: `perform marketplace_private.settle_order_meetup(${q(f.lid)});`,
        }
        const cancel = {
          identity: identity(1),
          op: `if(public.marketplace_cancel_order(${q(
            f.order.id
          )},'buyer_changed_mind','Synthetic D2A concurrency',${q(
            uuid()
          )})->>'errorCode') is not null then raise exception 'Order no longer cancellable' using errcode='23505';end if;`,
        }
        let a =
          kind.startsWith('payment') || kind === 'duplicate_payment'
            ? payment
            : inspection
        let b = kind.includes('expiry') ? expiry : cancel
        if (kind.startsWith('duplicate')) b = a
        const outcomes = await race(reverse ? b : a, reverse ? a : b)
        let s = await state(f)
        assert(
          outcomes.every(
            (x) => x === 'success' || /^(23505|23514|42501|P0001):/.test(x)
          )
        )
        assert.equal(s.offer, 'accepted')
        assert(s.terminal_events <= 1)
        assert(s.inspections <= 1)
        assert(s.inspection_events <= 1)
        assert.equal(s.held, s.life === 'open')
        assert.equal(s.listing, s.life === 'open' ? 'pending' : 'available')
        if (kind.startsWith('payment')) {
          assert.equal(
            s.life,
            reverse
              ? kind.includes('expiry')
                ? 'expired'
                : 'cancelled'
              : 'open'
          )
          assert.equal(s.attempts, reverse ? 0 : 1)
        }
        if (kind.startsWith('inspection_')) {
          assert.equal(
            s.life,
            kind.includes('expiry') ? 'expired' : 'cancelled'
          )
          assert.equal(s.inspections, reverse ? 0 : 1)
        }
        if (kind === 'duplicate_payment') {
          assert.equal(s.attempts, 1)
          assert.equal(s.started_events, 1)
        }
        if (kind === 'duplicate_inspection') {
          assert.equal(s.inspections, 1)
          assert.equal(s.inspection_events, 1)
        }
        if (s.payment === 'processing') {
          const rows = await query(
            `select id from marketplace_private.campus_payment_attempts where order_id=${q(
              f.order.id
            )} and status='processing';`
          )
          const r = await h.admin.rpc('marketplace_resolve_campus_payment', {
            p_attempt_id: rows[0].id,
            p_success: true,
          })
          assert(!r.error, r.error?.message)
          s = await state(f)
          assert.equal(s.payment, 'paid')
          assert.equal(s.life, 'open')
          assert.equal(s.listing, 'pending')
        }
        const bad = await query(
          `select count(*) bad from public.orders o join public.listings l on l.id=o.listing_id where o.id=${q(
            f.order.id
          )} and o.payment_status='paid' and(o.lifecycle_status<>'open' or not o.holds_listing or l.status<>'pending');`
        )
        assert.equal(bad[0].bad, 0)
        h.passed(
          kind +
            ' ' +
            (reverse ? 'terminal-first' : 'action-first') +
            ' ' +
            outcomes.map((x) => x.split(':')[0]).join('/')
        )
      }
    }
  } catch (e) {
    failure = e
  } finally {
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), baseline)
    fs.writeFileSync(
      root + '/d2a-concurrency-report.json',
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
