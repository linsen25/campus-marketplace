const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript')
function load(file, requireFn) {
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
  )(requireFn, module, module.exports)
  return module.exports
}
const schedule = load('lib/order-schedule-preview.ts', () => {
  throw Error('Unexpected dependency')
})
const p = load('lib/order-interaction-preview.ts', (name) => {
  assert.equal(name, './order-schedule-preview')
  return schedule
})
const now = Date.UTC(2026, 9, 12, 12),
  time = (n) => new Date(now + n).toISOString()
const visual = (buyer = 'buyer-a', method = 'pickup', price = 8000) => ({
  buyerId: buyer,
  sellerId: 'seller',
  buyer,
  seller: 'Seller',
  listing: {
    id: 'nike',
    title: 'Nike',
    price: 8000,
    photoUrls: [],
    status: 'available',
  },
  draft: {
    price,
    fulfillment: method,
    location: 'On campus',
    scheduleMode: method === 'shipping' ? 'tbd' : 'scheduled',
    scheduledAt: now + 86400000,
    shippingCost: 'arranged',
    shippingFee: null,
    shippingMethod: '',
    note: 'Original note',
  },
})
const send = (
  state,
  id,
  scope = 'conversation-a',
  value = visual(),
  replaceRequestId,
  offset = 0
) =>
  p.addPreviewRequest(state, id, scope, value, {
    createdAt: time(offset),
    replaceRequestId,
  })
const gate = (state, value = visual(), scope = 'conversation-a', offset = 0) =>
  p.getPreviewRequestSendGate(
    state,
    p.previewRequestScope(scope, value),
    now + offset
  )
let state = send(p.emptyInteractionPreview, 'a')
const a = state.requests[0],
  original = JSON.stringify(a.snapshot)
assert.equal(gate(state).active.id, 'a')
assert.equal(state.orders.length, 0)
assert.strictEqual(send(state, 'unconfirmed'), state) // cancel/no replacement approval
let b = visual('buyer-a', 'meet', 7500)
b.draft.location = 'UCC'
b.draft.scheduledAt += 86400000
state = send(state, 'b', 'conversation-a', b, 'a', 1000)
assert.deepEqual(
  state.requests.map((r) => r.status),
  ['superseded', 'active']
)
assert.equal(JSON.stringify(state.requests[0].snapshot), original)
assert.equal(state.requests[0].createdAt, a.createdAt)
assert.strictEqual(send(state, 'double', 'conversation-a', b, 'a', 1001), state)
assert.strictEqual(send(state, 'b', 'conversation-a', b, 'b', 1002), state)
state = send(
  state,
  'c',
  'conversation-a',
  visual('buyer-a', 'shipping'),
  'b',
  2000
)
assert.deepEqual(
  state.requests.map((r) => r.status),
  ['superseded', 'superseded', 'active']
)
assert.equal(state.requests.filter((r) => r.status === 'active').length, 1)
assert.strictEqual(p.acceptPreviewRequest(state, 'a', 'bad', now), state)
const later = p.expirePreviewRequests(state, now + 3 * 86400000)
assert.equal(later.requests[0].status, 'superseded')
assert.equal(later.requests[1].status, 'superseded')
assert.equal(later.requests[2].status, 'active') // shipping has no handoff expiry
let expired = send(p.emptyInteractionPreview, 'expired')
expired = p.expirePreviewRequests(expired, now + 86400000)
assert.equal(expired.requests[0].status, 'expired')
assert.equal(gate(expired, visual(), 'conversation-a', 86400000).active, null)
expired = send(expired, 'fresh', 'conversation-a', b, undefined, 86400000)
assert.deepEqual(
  expired.requests.map((r) => r.status),
  ['expired', 'active']
)
assert.strictEqual(
  p.acceptPreviewRequest(expired, 'expired', 'bad', now),
  expired
)
let multi = send(p.emptyInteractionPreview, 'buyer-a')
multi = send(multi, 'buyer-b', 'conversation-b', visual('buyer-b'))
const other = multi.requests[1]
multi = send(multi, 'new-a', 'conversation-a', b, 'buyer-a', 1000)
assert.strictEqual(multi.requests[1], other)
assert.equal(multi.requests.filter((r) => r.status === 'active').length, 2)
let accepted = send(p.emptyInteractionPreview, 'accept')
accepted = p.acceptPreviewRequest(accepted, 'accept', 'order', now)
assert.equal(accepted.requests[0].status, 'accepted')
assert.equal(accepted.orders[0].status, 'reserved')
assert(gate(accepted).blocked)
assert.strictEqual(
  send(accepted, 'blocked', 'conversation-a', b, 'accept'),
  accepted
)
assert.strictEqual(
  p.acceptPreviewRequest(accepted, 'accept', 'duplicate-order', now),
  accepted
)
for (const status of [
  'reserved',
  'paid',
  'shipped',
  'delivered',
  'protection',
]) {
  const activeOrder = {
    ...accepted,
    orders: [{ ...accepted.orders[0], status }],
  }
  assert(gate(activeOrder).blocked)
  assert.strictEqual(send(activeOrder, 'blocked'), activeOrder)
}
const held = {
  ...accepted,
  orders: [
    {
      ...accepted.orders[0],
      status: 'protection',
      issue: { role: 'buyer', reason: 'issue', detail: '' },
    },
  ],
}
assert(gate(held).blocked)
const released = p.updatePreviewOrder(
  accepted,
  'order',
  { type: 'cancel', reason: 'Changed mind' },
  'buyer',
  now
)
assert.equal(released.orders[0].status, 'cancelled')
assert.equal(released.requests[0].status, 'accepted')
assert(!gate(released).blocked)
const reopened = send(released, 'new-transaction')
assert.equal(reopened.requests[0].status, 'accepted')
assert.equal(reopened.requests[1].status, 'active')
assert.strictEqual(reopened.orders[0], released.orders[0])
// Accept wins -> Replace cannot overwrite Accepted; Replace wins -> old Accept cannot overwrite Replaced.
const first = send(p.emptyInteractionPreview, 'race')
const acceptWins = p.acceptPreviewRequest(first, 'race', 'race-order', now)
assert.strictEqual(
  send(acceptWins, 'replace', 'conversation-a', b, 'race'),
  acceptWins
)
const replaceWins = send(first, 'replace', 'conversation-a', b, 'race')
assert.strictEqual(
  p.acceptPreviewRequest(replaceWins, 'race', 'race-order', now),
  replaceWins
)
for (const value of state.requests) {
  assert(Object.isFrozen(value.snapshot))
  assert(Object.isFrozen(value.snapshot.draft))
  assert.equal(value.snapshot.listing.status, 'available')
}
console.log(
  'PASS A-L: first/confirmed replacement/repeated replacement/cancel; terminal expiry/accepted/replaced; unfinished-order block; buyer scope; duplicate IDs/stale approval; Accept-Replace ordering; immutable terms/time; no reservation until Accept'
)
