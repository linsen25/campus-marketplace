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
  assert(
    job?.active,
    'Qualification requires installed active minute scheduler'
  )
  try {
    // Temporarily pause this single job to keep artificial deadline fixtures from
    // being raced by a third scheduler session. Restore original activity in finally.
    await query(`select cron.alter_job(${Number(job.jobid)},active:=false);`)
    await h.setup()
    await h.capability('set', 1, 'payment_method')
    for (let repeat = 0; repeat < 2; repeat++) {
      let f = await paid()
      let cred = ok(
        await clients[1].rpc('marketplace_handoff_credential', {
          p_order_id: f.order.id,
        })
      )
      let cmd = uuid()
      await race(
        'duplicate handoff ' + repeat,
        verify(f, 'qr', cred.qrToken, cmd),
        verify(f, 'qr', cred.qrToken, cmd)
      )
      assert.equal((await fact(f)).handoffs, 1)
      assert.equal((await fact(f)).protection, 1)
      f = await paid()
      cred = ok(
        await clients[1].rpc('marketplace_handoff_credential', {
          p_order_id: f.order.id,
        })
      )
      await race(
        'QR vs numeric ' + repeat,
        verify(f, 'qr', cred.qrToken, uuid()),
        verify(f, 'code', cred.code, uuid())
      )
      assert.equal((await fact(f)).handoffs, 1)
      assert.equal((await fact(f)).protection, 1)
      for (const caseWins of [true, false]) {
        f = await paid()
        cred = ok(
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
          `update marketplace_private.order_protection set started_at=t.t-interval '24 hours'+interval '${
            caseWins ? '12 seconds' : '-1 second'
          }',expires_at=t.t+interval '${
            caseWins ? '12 seconds' : '-1 second'
          }' from(select clock_timestamp() t)t where order_id=${q(f.order.id)};`
        )
        const issue = {
          identity: actor(1),
          op: `perform public.marketplace_open_protection_case(${q(
            f.order.id
          )},'WRONG_ITEM',${q(uuid())});`,
        }
        const complete = {
          identity: trusted,
          op: `perform marketplace_private.settle_order_protection(${q(
            f.lid
          )});`,
        }
        await race(
          'case vs completion ' +
            (caseWins ? 'case wins ' : 'completion wins ') +
            repeat,
          caseWins ? issue : complete,
          caseWins ? complete : issue
        )
        const state = await fact(f)
        assert.equal(state.life, caseWins ? 'open' : 'completed')
        assert.equal(state.cases, caseWins ? 1 : 0)
        assert.equal(state.listing, caseWins ? 'pending' : 'sold')
        assert.equal(state.completed, caseWins ? 0 : 1)
      }
      for (const claimWins of [true, false]) {
        f = await claimFixture()
        await query(
          `update marketplace_private.delivery_checkouts set checkout_claim_deadline_at=clock_timestamp()+interval '${
            claimWins ? '12 seconds' : '-1 second'
          }' where order_id=${q(f.order.id)};`
        )
        const claim = {
          identity: actor(1),
          op: `perform public.marketplace_start_delivery_checkout(${q(
            f.order.id
          )});`,
        }
        const expiry = {
          identity: trusted,
          op: `perform marketplace_private.settle_delivery_checkout(${q(
            f.lid
          )});`,
        }
        await race(
          'checkout vs expiry ' +
            (claimWins ? 'checkout wins ' : 'expiry wins ') +
            repeat,
          claimWins ? claim : expiry,
          claimWins ? expiry : claim
        )
        const state = await fact(f)
        assert.equal(state.life, claimWins ? 'open' : 'expired')
        assert.equal(state.listing, claimWins ? 'pending' : 'available')
        assert.equal(state.expiries, claimWins ? 0 : 1)
      }
      f = await h.accepted('delivery')
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
      await query(
        `update marketplace_private.delivery_checkouts set checkout_started_at=t.t-interval '31 minutes',payment_deadline_at=t.t-interval '1 minute' from(select clock_timestamp() t)t where order_id=${q(
          f.order.id
        )};`
      )
      const expiry = {
          identity: trusted,
          op: `perform marketplace_private.settle_delivery_checkout(${q(
            f.lid
          )});`,
        },
        payment = {
          identity: trusted,
          op: `perform public.marketplace_resolve_campus_payment(${q(
            p.attemptId
          )},true);`,
        }
      await race(
        'Processing expiry vs Paid ' + repeat,
        repeat ? payment : expiry,
        repeat ? expiry : payment
      )
      const state = await fact(f)
      assert.equal(state.payment, 'paid')
      assert.equal(state.life, 'open')
      assert.equal(state.listing, 'pending')
      assert.equal(state.held, true)
      assert.equal(state.expiries, 0)
    }
  } finally {
    try {
      await h.cleanup()
      assert.deepEqual(await h.fingerprint(), baseline)
    } finally {
      await query(`select cron.alter_job(${Number(job.jobid)},active:=true);`)
    }
  }
  console.log(
    JSON.stringify({
      runs: outcomes.length,
      outcomes,
      deadlocks: 0,
      lockTimeouts: 0,
      invariantFailures: 0,
      canonicalBaselineUnchanged: true,
      fixturesCleaned: true,
    })
  )
}
run().catch((error) => {
  console.error(
    'Backend concurrency qualification failed; sensitive diagnostics remain ignored'
  )
  console.error(
    JSON.stringify({
      errorType: error.name,
      mediaTransport: error.message === 'Snapshot upload failed. Retry.',
      deadlock: error.code === '40P01',
      lockTimeout: error.code === '55P03',
      invariantAssertion: error.code === 'ERR_ASSERTION',
      source: error.stack
        ?.split('\n')
        .find((line) => line.includes(' at '))
        ?.trim()
        .replace(/\([^)]*\)/, '(local source)'),
    })
  )
  process.exitCode = 1
})
