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
  const tag = 'd1race_' + crypto.randomUUID().replaceAll('-', '')
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

const time = () =>
  new Date(
    Math.ceil((Date.now() + 8 * 3600000) / 900000) * 900000
  ).toISOString()
const terms = (location) => ({
  location,
  scheduled_at: time(),
  note: 'Synthetic concurrency',
})
const op = (
  f,
  action,
  who,
  revision = null,
  v = null,
  key = crypto.randomUUID()
) => ({
  identity: identity(who),
  op: `perform public.marketplace_order_meetup_action(${q(f.order.id)},${q(
    action
  )},${revision ? q(revision) : 'null'},${
    v ? q(JSON.stringify(v)) + '::jsonb' : 'null'
  },${q(key)});`,
})
async function pending(f) {
  const r = await clients[1].rpc('marketplace_order_meetup_action', {
    p_order_id: f.order.id,
    p_action: 'propose',
    p_revision_id: null,
    p_terms: terms('Synthetic new library'),
    p_client_action_id: crypto.randomUUID(),
  })
  assert(!r.error, r.error?.message)
  return r.data.revisionId
}
async function age(f) {
  await query(
    `begin;lock table public.orders in access exclusive mode;alter table public.order_meetup_revisions disable trigger order_meetup_guard;alter table public.order_meetup_revisions disable trigger order_meetup_event;update public.order_meetup_revisions set scheduled_at=clock_timestamp()-interval '65 minutes' where order_id=${q(
      f.order.id
    )} and status='confirmed';alter table public.order_meetup_revisions enable trigger order_meetup_event;alter table public.order_meetup_revisions enable trigger order_meetup_guard;commit;`
  )
}
async function state(f) {
  return (
    await query(`select o.lifecycle_status,o.holds_listing,l.status listing,r.status offer,
 (select count(*) from public.order_meetup_revisions where order_id=o.id and status='pending') pending,
 (select count(*) from public.order_meetup_revisions where order_id=o.id and status='confirmed') confirmed,
 (select count(*) from public.transaction_events where order_id=o.id and event_type='order_no_show_expired') expired_events,
 (select count(*) from public.transaction_events where order_id=o.id and event_type='order_cancelled') cancelled_events,
 (select count(*) from public.transaction_events where order_id=o.id and event_type='meetup_confirmed') confirmed_events,
 (select count(*) from marketplace_private.order_snapshot_media where order_id=o.id) retained_media
 from public.orders o join public.listings l on l.id=o.listing_id join public.order_requests r on r.id=o.request_id where o.id=${q(
   f.order.id
 )};`)
  )[0]
}
;(async () => {
  const before = await h.fingerprint()
  let failed
  try {
    await h.setup()
    for (const kind of [
      'proposals',
      'confirm_replace',
      'confirm_cancel',
      'expiry_confirm',
      'expiry_cancel',
      'expiry_proposal',
      'duplicate_propose',
      'duplicate_confirm',
    ]) {
      for (const reverse of kind.startsWith('duplicate')
        ? [false]
        : [false, true]) {
        const f = await h.accepted()
        let rev
        if (
          [
            'confirm_replace',
            'confirm_cancel',
            'expiry_confirm',
            'duplicate_confirm',
          ].includes(kind)
        )
          rev = await pending(f)
        if (kind.startsWith('expiry')) await age(f)
        let a, b
        const expiry = {
          identity: '',
          op: `perform marketplace_private.settle_order_meetup(${q(f.lid)});`,
        }
        const cancel = {
          identity: identity(1),
          op: `if(public.marketplace_cancel_order(${q(
            f.order.id
          )},'buyer_changed_mind','Synthetic concurrent cancellation',${q(
            crypto.randomUUID()
          )})->>'errorCode') is not null then raise exception 'Order no longer cancellable' using errcode='23505';end if;`,
        }
        if (kind === 'proposals') {
          a = op(f, 'propose', 1, null, terms('Buyer proposal'))
          b = op(f, 'propose', 0, null, terms('Seller proposal'))
        }
        if (kind === 'confirm_replace') {
          a = op(f, 'confirm', 0, rev)
          b = op(f, 'propose', 1, null, terms('Replacement proposal'))
        }
        if (kind === 'confirm_cancel') {
          a = op(f, 'confirm', 0, rev)
          b = cancel
        }
        if (kind === 'expiry_confirm') {
          a = expiry
          b = op(f, 'confirm', 0, rev)
        }
        if (kind === 'expiry_cancel') {
          a = expiry
          b = cancel
        }
        if (kind === 'expiry_proposal') {
          a = expiry
          b = op(f, 'propose', 1, null, terms('One-sided future proposal'))
        }
        if (kind === 'duplicate_propose') {
          a = op(f, 'propose', 1, null, terms('Identical proposal'))
          b = a
        }
        if (kind === 'duplicate_confirm') {
          a = op(f, 'confirm', 0, rev)
          b = a
        }
        const outcomes = await race(reverse ? b : a, reverse ? a : b),
          s = await state(f)
        assert(
          outcomes.every(
            (x) => x === 'success' || /^(23505|23514|42501|P0001):/.test(x)
          ),
          JSON.stringify(outcomes)
        )
        assert(s.pending <= 1)
        assert.equal(s.offer, 'accepted')
        assert.equal(s.retained_media, 3)
        assert(s.expired_events + s.cancelled_events <= 1)
        assert.equal(s.holds_listing, s.lifecycle_status === 'open')
        assert.equal(
          s.listing,
          s.lifecycle_status === 'open' ? 'pending' : 'available'
        )
        if (kind === 'proposals') assert.equal(s.pending, 1)
        if (kind === 'confirm_replace') {
          assert.equal(s.confirmed_events, reverse ? 0 : 1)
          assert.equal(s.pending, 1)
        }
        if (kind === 'confirm_cancel') {
          assert.equal(s.lifecycle_status, 'cancelled')
          assert.equal(s.confirmed_events, reverse ? 0 : 1)
        }
        if (kind === 'expiry_confirm') {
          assert.equal(s.lifecycle_status, reverse ? 'open' : 'expired')
          assert.equal(s.confirmed_events, reverse ? 1 : 0)
        }
        if (kind === 'expiry_cancel') {
          assert.equal(s.lifecycle_status, reverse ? 'cancelled' : 'expired')
        }
        if (kind === 'expiry_proposal')
          assert.equal(s.lifecycle_status, 'expired')
        if (kind === 'duplicate_propose') {
          assert.equal(s.pending, 1)
          const rows = await query(
            `select count(*) n from public.order_meetup_revisions where order_id=${q(
              f.order.id
            )} and revision>0;`
          )
          assert.equal(rows[0].n, 1)
        }
        if (kind === 'duplicate_confirm') {
          assert.equal(s.confirmed_events, 1)
          assert.equal(s.confirmed, 2)
        }
        report.checks.push(
          kind + '-' + (reverse ? 'second-first' : 'first-first')
        )
        console.log(
          'PASS ' +
            report.checks.at(-1) +
            ' ' +
            outcomes.map((x) => x.split(':')[0]).join('/')
        )
      }
    }
  } catch (e) {
    failed = e
    console.error(e.stack)
  } finally {
    await h.cleanup()
    assert.deepEqual(await h.fingerprint(), before)
    report.syntheticCleanup = true
    report.manualMediaFingerprintUnchanged = true
    fs.writeFileSync(root + '/concurrency-report.json', JSON.stringify(report))
    console.log(JSON.stringify(report))
  }
  if (failed) throw failed
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
