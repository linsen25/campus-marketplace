// Qualify the real reset engine against a TEST-INJECTED, fresh UUID allowlist.
// The normal CLI's checked-in canonical allowlist is never changed or overridden.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
assert(
  !fs.existsSync('tests/artifacts/meetup-d1-fixtures/scope.json'),
  'Existing fixture journal: stop'
)
const h = require('./order-meetup-fixtures.cjs')
const tools = require('../scripts/v2-maintenance-staging.cjs')
async function run() {
  const baseline = await h.fingerprint()
  const original = require('../scripts/canonical-demo-allowlist.cjs')
  const saved = JSON.stringify(original)
  const resolved = require.resolve('../scripts/canonical-demo-allowlist.cjs')
  const journal = path.resolve(
    'tests/artifacts/v2-maintenance/reset-journal.json'
  )
  assert(!fs.existsSync(journal), 'Existing reset journal: stop')
  let engine
  try {
    await h.setup()
    const f = await h.fixture('on_campus')
    const originalOffer = (
      await h.query(
        `select conversation_id,offer_terms from public.order_requests where id=${h.q(
          f.offer
        )}`
      )
    )[0]
    const revised = await h.clients[0].rpc('marketplace_submit_offer', {
      p_conversation_id: originalOffer.conversation_id,
      p_terms: {
        ...originalOffer.offer_terms,
        note: "Literal $$; SELECT 'data only'; -- \\ quote '",
      },
      p_comparison_offer_id: f.offer,
      p_kind: 'revise',
      p_client_action_id: require('node:crypto').randomUUID(),
    })
    assert(!revised.error, revised.error?.code)
    h.offers.push(revised.data.id)
    h.journal()
    f.offer = revised.data.id
    const command = require('node:crypto').randomUUID(),
      batch = await h.prepare(f, command, 1)
    const accepted = await h.accept(f, batch, command, 1)
    assert(!accepted.error, accepted.error?.code)
    f.order = accepted.data
    assert(
      !Object.hasOwn(original.listings, f.lid) &&
        !original.protectedListings.includes(f.lid),
      'Synthetic target must be outside canonical/historical scope'
    )
    require.cache[resolved].exports = {
      sellers: [h.users[0]],
      buyers: h.users.slice(1),
      listings: { [f.lid]: h.users[0] },
      protectedListings: [
        ...Object.keys(original.listings),
        ...original.protectedListings,
      ],
      protectedOffers: [],
      protectedOrders: [],
    }
    engine = require('../scripts/demo-reset-v2-staging.cjs')
    const sql = engine.inspectSQL([f.lid])
    const scope = tools.query('begin read only;' + sql + ';rollback;')[0].scope
    const flags = [
      '--listing',
      f.lid,
      '--apply',
      '--plan-sha',
      tools.hash(scope),
      ...scope.offers.flatMap((r) => ['--offer', r.id]),
    ]
    await engine.main(flags)
    const after = tools.query('begin read only;' + sql + ';rollback;')[0].scope
    assert.equal(
      after.offers.length + after.orders.length + after.batches.length,
      0
    )
    assert.equal(after.listings[0].status, 'available')
    assert.equal(after.snapshotAssets, 0)
    console.log(
      'PASS actual reset SQL + lease-based bound snapshot cleanup against exclusively fresh synthetic UUID allowlist'
    )
  } finally {
    require.cache[resolved].exports = original
    assert.equal(JSON.stringify(original), saved, 'Canonical allowlist changed')
    await h.cleanup()
    assert.deepEqual(
      await h.fingerprint(),
      baseline,
      'Retained canonical/Nike/D1 graph changed'
    )
    // Only reconcile a journal proven to target this exact newly created test graph.
    if (fs.existsSync(journal)) {
      const j = JSON.parse(fs.readFileSync(journal, 'utf8'))
      assert(j.targets.every((id) => h.listings.includes(id)))
      fs.unlinkSync(journal)
    }
    for (const c of h.clients) c.auth.stopAutoRefresh()
    for (const name of fs.readdirSync(h.root))
      fs.unlinkSync(path.join(h.root, name))
    fs.rmdirSync(h.root)
  }
}
run().catch((error) => {
  fs.mkdirSync('tests/artifacts/v2-maintenance', { recursive: true })
  fs.writeFileSync(
    'tests/artifacts/v2-maintenance/reset-test-error.json',
    JSON.stringify({ message: error.message, stack: error.stack })
  )
  console.error(
    'Synthetic reset qualification failed; details in ignored reset-test-error.json'
  )
  process.exitCode = 1
})
