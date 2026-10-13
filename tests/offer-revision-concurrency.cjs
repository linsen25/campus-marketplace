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

async function run() {
  const baseline = await h.fingerprint()
  try {
    await h.setup()
    const rounds = Number(process.env.CONCURRENCY_ROUNDS || 2)
    assert(Number.isInteger(rounds) && rounds >= 1 && rounds <= 10)
    for (let repeat = 0; repeat < rounds; repeat++) {
      for (const scenario of [
        'buyer-confirms',
        'seller-confirms',
        'withdraw-wins',
        'confirm-over-withdraw',
        'revise-wins',
        'confirm-over-revise',
      ]) {
        const f = await h.fixture('on_campus')
        const sellerOffer = (
          await query(
            'select conversation_id,offer_terms from public.order_requests where id=' +
              q(f.offer)
          )
        )[0]
        const buyerOffer = ok(
          await clients[1].rpc('marketplace_submit_offer', {
            p_conversation_id: sellerOffer.conversation_id,
            p_terms: sellerOffer.offer_terms,
            p_client_action_id: uuid(),
            p_comparison_offer_id: f.offer,
            p_kind: 'counter',
          })
        )
        h.offers.push(buyerOffer.id)
        h.journal()
        const sellerCommand = uuid(),
          buyerCommand = uuid()
        const sellerBatch = await h.prepare(f, sellerCommand, 1)
        const buyerBatch = await h.prepare(
          { ...f, offer: buyerOffer.id },
          buyerCommand,
          0
        )
        const confirmSeller = {
          identity: actor(1),
          op:
            'perform public.marketplace_accept_offer(' +
            q(f.offer) +
            ',' +
            q(sellerCommand) +
            ',' +
            q(sellerBatch.id) +
            ');',
        }
        const confirmBuyer = {
          identity: actor(0),
          op:
            'perform public.marketplace_accept_offer(' +
            q(buyerOffer.id) +
            ',' +
            q(buyerCommand) +
            ',' +
            q(buyerBatch.id) +
            ');',
        }
        const withdraw = {
          identity: actor(0),
          op:
            'perform public.marketplace_withdraw_offer(' +
            q(f.offer) +
            ',' +
            q(uuid()) +
            ');',
        }
        const revise = {
          identity: actor(0),
          op:
            'perform public.marketplace_submit_offer(' +
            q(sellerOffer.conversation_id) +
            ',' +
            q(
              JSON.stringify({
                ...sellerOffer.offer_terms,
                item_amount_cents: 7400,
              })
            ) +
            '::jsonb,' +
            q(uuid()) +
            ',' +
            q(f.offer) +
            ',' +
            q('revise') +
            ');',
        }
        let operations
        if (scenario === 'buyer-confirms')
          operations = [confirmSeller, confirmBuyer]
        else if (scenario === 'seller-confirms')
          operations = [confirmBuyer, confirmSeller]
        else if (scenario === 'withdraw-wins')
          operations = [withdraw, confirmSeller]
        else if (scenario === 'confirm-over-withdraw')
          operations = [confirmSeller, withdraw]
        else if (scenario === 'revise-wins')
          operations = [revise, confirmSeller]
        else operations = [confirmSeller, revise]
        const result = await race(scenario + ' ' + repeat, ...operations)
        assert.equal(result[0].outcome, 'success')
        assert.notEqual(result[1].outcome, 'success')
        const state = (
          await query(
            "select l.status listing,(select count(*) from public.orders o where o.listing_id=l.id) orders,(select count(*) from public.order_requests r where r.listing_id=l.id and r.status='accepted') accepted,(select count(*) from public.order_requests r where r.listing_id=l.id and r.status='closed') closed,(select count(*) from public.transaction_events e join public.order_requests r on r.id=e.request_id where r.listing_id=l.id and e.event_type='offer_accepted') accepted_events,(select count(*) from public.transaction_events e join public.order_requests r on r.id=e.request_id where r.listing_id=l.id and e.event_type='order_created') order_events from public.listings l where l.id=" +
              q(f.lid)
          )
        )[0]
        const wonOrder = !['withdraw-wins', 'revise-wins'].includes(scenario)
        assert.equal(state.listing, wonOrder ? 'pending' : 'available')
        for (const field of [
          'orders',
          'accepted',
          'accepted_events',
          'order_events',
        ])
          assert.equal(Number(state[field]), wonOrder ? 1 : 0, field)
        assert.equal(Number(state.closed), wonOrder ? 1 : 0)
      }
    }
  } finally {
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      baseline,
      'Canonical/manual baseline unchanged'
    )
  }
  console.log(
    JSON.stringify({
      runs: outcomes.length,
      outcomes,
      deadlocks: 0,
      lockTimeouts: 0,
      invariantFailures: 0,
      fixturesCleaned: true,
      canonicalAndManualUnchanged: true,
    })
  )
}
run().catch((error) => {
  console.error(
    'Offer revision concurrency failed:',
    error.code || error.message
  )
  process.exitCode = 1
})
