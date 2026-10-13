// Independent hosted transactions with observed lock overlap, synthetic data only.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const h = require('./order-meetup-fixtures.cjs')
const { query, q, users, clients, admin } = h
const uuid = () => crypto.randomUUID()
const outcomes = []
const actor = (i) =>
  `select set_config('request.jwt.claims',${q(
    JSON.stringify({ sub: users[i], role: 'authenticated' })
  )},true);`
const trusted = `select set_config('request.jwt.claims','{"role":"service_role","ref":"pcaqxezdfxofysghssyo"}',true);`
const ok = (r) => {
  assert(!r.error, r.error?.code || 'transport')
  return r.data
}
function tx(tag, identity, operation, hold) {
  return `begin;set local application_name=${q(
    tag
  )};set local lock_timeout='40s';${identity}
do $$begin perform set_config('bc.outcome','success',true);begin ${operation}
exception when unique_violation or check_violation or insufficient_privilege or raise_exception then
perform set_config('bc.outcome',sqlstate,true);end;end$$;
${
  hold ? 'select pg_sleep(18);' : ''
}select current_setting('bc.outcome') outcome,pg_backend_pid() pid,txid_current() xid;commit;`
}
async function race(name, first, second) {
  const tag = 'bc_' + uuid().replaceAll('-', '')
  const a = query(tx(tag, first.identity, first.op, true))
  a.catch(() => {})
  let asleep = false
  for (let i = 0; i < 8; i++) {
    const r = await query(
      `select wait_event from pg_stat_activity where application_name=${q(
        tag
      )};`
    )
    if (r[0]?.wait_event === 'PgSleep') {
      asleep = true
      break
    }
  }
  assert(asleep, 'First independent transaction holds locks')
  const b = query(tx(tag + '_b', second.identity, second.op, false))
  b.catch(() => {})
  let blocked = false
  for (let i = 0; i < 8; i++) {
    const r = await query(
      `select wait_event_type,cardinality(pg_blocking_pids(pid)) blockers from pg_stat_activity where application_name=${q(
        tag + '_b'
      )};`
    )
    if (r[0]?.wait_event_type === 'Lock' && r[0].blockers > 0) {
      blocked = true
      break
    }
  }
  assert(blocked, 'Second independent transaction demonstrably overlaps')
  const results = (await Promise.all([a, b])).map((rows) =>
    rows.find((row) => 'outcome' in row)
  )
  assert.notEqual(results[0].pid, results[1].pid)
  assert.notEqual(results[0].xid, results[1].xid)
  assert(!results.some((r) => ['40P01', '55P03'].includes(r.outcome)))
  outcomes.push({
    name,
    outcomes: results.map((r) => r.outcome),
    independentPids: true,
    independentXids: true,
    lockOverlap: true,
  })
  console.log('PASS concurrent ' + name)
  return results
}
async function paid(mode = 'on_campus') {
  const f = await h.accepted(mode)
  if (mode === 'on_campus')
    ok(
      await clients[1].rpc('marketplace_confirm_campus_inspection', {
        p_order_id: f.order.id,
        p_client_action_id: uuid(),
      })
    )
  else
    ok(
      await clients[1].rpc('marketplace_save_delivery_address', {
        p_order_id: f.order.id,
        p_address: {
          country_code: 'CA',
          province_code: 'ON',
          city: 'London',
          postal_code: 'N6A1A1',
          street: 'Synthetic disposable street',
        },
      })
    )
  const p = ok(
    await clients[1].rpc('marketplace_start_order_payment', {
      p_order_id: f.order.id,
      p_client_action_id: uuid(),
    })
  )
  ok(
    await admin.rpc('marketplace_resolve_campus_payment', {
      p_attempt_id: p.attemptId,
      p_success: true,
    })
  )
  return f
}
async function fact(f) {
  return (
    await query(`select o.lifecycle_status life,o.payment_status payment,o.holds_listing held,l.status listing,
(select count(*) from public.transaction_events where order_id=o.id and event_type='handoff_confirmed') handoffs,
(select count(*) from public.transaction_events where order_id=o.id and event_type='protection_started') protection,
(select count(*) from public.transaction_events where order_id=o.id and event_type='order_completed') completed,
(select count(*) from marketplace_private.protection_cases where order_id=o.id) cases,
(select count(*) from public.transaction_events where order_id=o.id and event_type='reservation_expired') expiries
from public.orders o join public.listings l on l.id=o.listing_id where o.id=${q(
      f.order.id
    )};`)
  )[0]
}
function verify(f, channel, secret, cmd) {
  return {
    identity: actor(0),
    op: `perform public.marketplace_verify_handoff(${q(f.order.id)},${q(
      channel
    )},${q(secret)},${q(cmd)});`,
  }
}
async function claimFixture() {
  const f = await h.fixture('delivery')
  const cid = (
    await query(
      `select conversation_id from public.order_requests where id=${q(
        f.offer
      )};`
    )
  )[0].conversation_id
  const original = (
    await clients[0].rpc('marketplace_offer_history', {
      p_conversation_id: cid,
    })
  ).data.offers.find((r) => r.id === f.offer)
  ok(
    await clients[1].rpc('marketplace_create_offer', {
      p_conversation_id: cid,
      p_terms: original.offer_terms,
      p_client_action_id: uuid(),
    })
  )
  const row = (
    await query(
      `select id from public.order_requests where conversation_id=${q(
        cid
      )} and status='active';`
    )
  )[0]
  h.offers.push(row.id)
  h.journal()
  f.offer = row.id
  const batch = await h.prepare(f, uuid(), 0)
  f.order = ok(await h.accept(f, batch, uuid(), 0))
  return f
}
async function run() {
  const baseline = await h.fingerprint()
  const job = (
    await query(
      "select jobid,active from cron.job where jobname='marketplace-v2-transaction-due-work';"
    )
  )[0]
  assert(job.active)
  try {
    await query(
      'select cron.alter_job(' + Number(job.jobid) + ',active:=false);'
    )
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    for (let repeat = 0; repeat < 2; repeat++) {
      for (const paymentWins of [true, false]) {
        const f = await h.accepted('delivery')
        ok(
          await clients[1].rpc('marketplace_save_delivery_address', {
            p_order_id: f.order.id,
            p_address: {
              country_code: 'CA',
              province_code: 'ON',
              city: 'London',
              postal_code: 'N6A1A1',
              street: 'Synthetic disposable street',
            },
          })
        )
        await query(
          "update marketplace_private.delivery_checkouts set checkout_started_at=t.t-interval '30 minutes'+interval " +
            q(paymentWins ? '12 seconds' : '-1 second') +
            ',payment_deadline_at=t.t+interval ' +
            q(paymentWins ? '12 seconds' : '-1 second') +
            ' from(select clock_timestamp() t)t where order_id=' +
            q(f.order.id) +
            ';'
        )
        const start = {
            identity: actor(1),
            op:
              'perform public.marketplace_start_order_payment(' +
              q(f.order.id) +
              ',' +
              q(uuid()) +
              ');',
          },
          expire = {
            identity: trusted,
            op:
              'perform marketplace_private.settle_delivery_checkout(' +
              q(f.lid) +
              ');',
          }
        await race(
          'Pending Payment vs deadline ' +
            (paymentWins ? 'Processing wins ' : 'expiry wins ') +
            repeat,
          paymentWins ? start : expire,
          paymentWins ? expire : start
        )
        let state = await fact(f)
        assert.equal(state.life, paymentWins ? 'open' : 'expired')
        assert.equal(state.payment, paymentWins ? 'processing' : 'pending')
        assert.equal(state.listing, paymentWins ? 'pending' : 'available')
        assert.equal(state.expiries, paymentWins ? 0 : 1)
        if (paymentWins) {
          const a = (
            await query(
              'select id from marketplace_private.campus_payment_attempts where order_id=' +
                q(f.order.id) +
                ';'
            )
          )[0]
          ok(
            await admin.rpc('marketplace_resolve_campus_payment', {
              p_attempt_id: a.id,
              p_success: true,
            })
          )
          state = await fact(f)
          assert.equal(state.payment, 'paid')
          assert.equal(state.listing, 'pending')
        }
      }
      const f = await h.accepted()
      ok(
        await clients[1].rpc('marketplace_confirm_campus_inspection', {
          p_order_id: f.order.id,
          p_client_action_id: uuid(),
        })
      )
      const cancel = {
          identity: actor(1),
          op:
            'perform public.marketplace_cancel_order(' +
            q(f.order.id) +
            ',' +
            q('buyer_changed_mind') +
            ',' +
            q('Synthetic concurrency') +
            ',' +
            q(uuid()) +
            ');',
        },
        start = {
          identity: actor(1),
          op:
            'perform public.marketplace_start_order_payment(' +
            q(f.order.id) +
            ',' +
            q(uuid()) +
            ');',
        }
      await race(
        'Cancel vs shared Payment ' + repeat,
        repeat ? start : cancel,
        repeat ? cancel : start
      )
      const state = await fact(f)
      assert.equal(state.life, repeat ? 'open' : 'cancelled')
      assert.equal(state.payment, repeat ? 'processing' : 'pending')
      assert.equal(state.listing, repeat ? 'pending' : 'available')
    }
    const f = await paid()
    const cred = ok(
      await clients[1].rpc('marketplace_handoff_credential', {
        p_order_id: f.order.id,
      })
    )
    ok(
      await clients[0].rpc('marketplace_verify_handoff', {
        p_order_id: f.order.id,
        p_channel: 'qr',
        p_credential: cred.qrToken,
        p_client_action_id: uuid(),
      })
    )
    await query(
      "update marketplace_private.order_protection set started_at=t.t-interval '25 hours',expires_at=t.t-interval '1 hour' from(select clock_timestamp() t)t where order_id=" +
        q(f.order.id) +
        ';'
    )
    const tag = 'bc_worker_' + uuid().replaceAll('-', '')
    const a = query(
      tx(
        tag,
        trusted,
        "perform set_config('bc.outcome',marketplace_private.run_transaction_due_work()::text,true);",
        true
      )
    )
    a.catch(() => {})
    let sleeping = false
    for (let i = 0; i < 8; i++) {
      const r = await query(
        'select wait_event from pg_stat_activity where application_name=' +
          q(tag) +
          ';'
      )
      if (r[0]?.wait_event === 'PgSleep') {
        sleeping = true
        break
      }
    }
    assert(sleeping)
    const b = query(
      tx(
        tag + '_b',
        trusted,
        "perform set_config('bc.outcome',marketplace_private.run_transaction_due_work()::text,true);",
        false
      )
    )
    b.catch(() => {})
    const result = (await Promise.all([a, b])).map((rows) =>
      rows.find((r) => 'outcome' in r)
    )
    assert.notEqual(result[0].pid, result[1].pid)
    assert.equal(JSON.parse(result[1].outcome).overlapSkipped, true)
    assert.equal((await fact(f)).completed, 1)
    assert.equal((await fact(f)).listing, 'sold')
    outcomes.push({
      name: 'overlapping worker',
      independentPids: true,
      overlapSkipped: true,
    })
  } finally {
    try {
      await h.cleanup()
      assert.deepEqual(await h.fingerprint(), baseline)
    } finally {
      await query(
        'select cron.alter_job(' + Number(job.jobid) + ',active:=true);'
      )
    }
  }
  console.log(
    JSON.stringify({
      runs: outcomes.length,
      outcomes,
      deadlocks: 0,
      lockTimeouts: 0,
      invariantFailures: 0,
      fixturesCleaned: true,
      canonicalBaselineUnchanged: true,
    })
  )
}
run().catch((error) => {
  console.error(
    'Deadline concurrency qualification failed; sensitive diagnostics ignored'
  )
  console.error(
    JSON.stringify({
      errorType: error.name,
      mediaTransport: error.message === 'Snapshot upload failed. Retry.',
      source: error.stack
        ?.split('\n')
        .find((line) => line.includes(' at '))
        ?.trim()
        .replace(/\([^)]*\)/, '(local source)'),
    })
  )
  process.exitCode = 1
})
