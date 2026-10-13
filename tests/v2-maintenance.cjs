// Local safety contract. No network or database writes.
const assert = require('node:assert/strict'),
  { spawnSync } = require('node:child_process')
const { validate, inspectSQL } = require('../scripts/demo-reset-v2-staging.cjs')
const allow = require('../scripts/canonical-demo-allowlist.cjs')
const lid = Object.keys(allow.listings)[0],
  buyer = allow.buyers[0],
  seller = allow.listings[lid]
const scope = {
  listings: [{ id: lid, seller_id: seller }],
  conversations: [
    { id: 'conversation', listing_id: lid, buyer_id: buyer, seller_id: seller },
  ],
  offers: [
    {
      id: 'offer',
      protocol_version: 2,
      listing_id: lid,
      conversation_id: 'conversation',
      buyer_id: buyer,
      seller_id: seller,
      sender_user_id: buyer,
      recipient_user_id: seller,
    },
  ],
  orders: [],
  batches: [],
}
validate(scope, [lid])
const copy = () => JSON.parse(JSON.stringify(scope))
assert.throws(() => validate(scope, [allow.protectedListings[0]]))
assert.throws(() => validate(scope, [allow.protectedListings[1]]))
assert.throws(() => validate(scope, ['unrelated']))
let bad = copy()
bad.offers[0].protocol_version = 1
assert.throws(() => validate(bad, [lid]))
bad = copy()
bad.conversations[0].buyer_id = 'outsider'
assert.throws(() => validate(bad, [lid]))
bad = copy()
bad.listings[0].seller_id = 'outsider'
assert.throws(() => validate(bad, [lid]))
bad = copy()
bad.listings[0].reserved_order_id = 'external-order'
assert.throws(() => validate(bad, [lid]))
bad = copy()
bad.batches = [{ offer_id: 'unrelated', listing_id: lid }]
assert.throws(() => validate(bad, [lid]))
bad = copy()
bad.orders = [
  { id: 'foreign', request_id: 'unknown', order_protocol_version: 2 },
]
assert.throws(() => validate(bad, [lid]))
assert(!/\b(?:update|delete|insert|alter)\b/i.test(inspectSQL([lid])))
for (const env of [
  { APP_ENV: 'production' },
  { NEXT_PUBLIC_SUPABASE_URL: 'https://yzvchumzyonegujucyqs.supabase.co' },
]) {
  const r = spawnSync(process.execPath, ['scripts/demo-reset-v2-staging.cjs'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
  })
  assert.notEqual(r.status, 0)
  assert.equal(r.stdout, '', 'Production guard must reject before query/plan')
}
const rejected = spawnSync(
  process.execPath,
  [
    'scripts/demo-reset-v2-staging.cjs',
    '--listing',
    allow.protectedListings[1],
  ],
  { encoding: 'utf8' }
)
assert.notEqual(rejected.status, 0)
assert.equal(rejected.stdout, '')
console.log(
  'PASS local maintenance guards: production before network, explicit IDs, protected Nike/D1, V1/outsider/owner/Order/media ambiguity, read-only plan'
)
