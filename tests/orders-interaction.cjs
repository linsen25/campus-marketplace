// Pure local preview transitions. No network, Auth accounts, fixtures or database.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript')
const compiled = ts.transpileModule(
  fs.readFileSync('lib/order-interaction-preview.ts', 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS } }
).outputText
const mod = { exports: {} }
new Function('require', 'module', 'exports', compiled)(
  (id) => {
    if (id !== './order-schedule-preview')
      throw Error('Unexpected runtime dependency')
    const result = { exports: {} }
    new Function(
      'module',
      'exports',
      ts.transpileModule(
        fs.readFileSync('lib/order-schedule-preview.ts', 'utf8'),
        { compilerOptions: { module: ts.ModuleKind.CommonJS } }
      ).outputText
    )(result, result.exports)
    return result.exports
  },
  mod,
  mod.exports
)
const p = mod.exports,
  now = 1000000
const addRequest = p.addPreviewRequest
p.addPreviewRequest = (state, id, conversationId, visual) =>
  addRequest(state, id, conversationId, visual, {
    createdAt: new Date(now).toISOString(),
    replaceRequestId: p.getPreviewRequestSendGate(
      state,
      p.previewRequestScope(conversationId, visual),
      now
    ).active?.id,
  })
const visual = (method) => ({
  listing: {
    id: 'listing',
    title: 'Synthetic listing',
    photoUrls: ['local'],
    price: 8000,
  },
  draft: {
    price: 8000,
    fulfillment: method,
    location: 'UCC',
    scheduleMode: method === 'shipping' ? 'tbd' : 'scheduled',
    scheduledAt: now + 86400000,
    shippingCost: 'flat',
    shippingFee: method === 'shipping' ? 1000 : 0,
    shippingMethod: 'Canada Post',
    note: 'Immutable note',
  },
  buyer: 'Buyer',
  seller: 'Seller',
})
assert(
  p.isStagingOrderPreview('staging', 'https://pcaqxezdfxofysghssyo.supabase.co')
)
for (const [env, url] of [
  ['production', 'https://pcaqxezdfxofysghssyo.supabase.co'],
  ['staging', 'https://yzvchumzyonegujucyqs.supabase.co'],
  ['unknown', ''],
  [undefined, undefined],
])
  assert(!p.isStagingOrderPreview(env, url))
for (const amount of ['', ' ', '-1', '0', '1.234', 'NaN', '1e3', 'Infinity'])
  assert.equal(p.parsePreviewCurrency(amount), null)
assert.equal(p.parsePreviewCurrency('0', true), 0)
assert.equal(p.parsePreviewCurrency('80.01'), 8001)
const address = {
  recipient: 'Synthetic Recipient',
  address: '123 Example Street',
  unit: '',
  city: 'London',
  province: 'ON',
  postal: 'N6A 1A1',
}
assert(p.validPreviewAddress(address))
assert(!p.validPreviewAddress({ ...address, postal: 'bad' }))
let state = p.emptyInteractionPreview
const original = visual('pickup')
state = p.addPreviewRequest(state, 'old', 'conversation', original)
original.draft.price = 9000
original.listing.title = 'Edited outside preview'
assert.equal(state.requests[0].snapshot.draft.price, 8000)
assert.equal(state.requests[0].snapshot.listing.title, 'Synthetic listing')
state = p.addPreviewRequest(state, 'new', 'conversation', visual('pickup'))
assert.equal(state.requests[0].status, 'superseded')
assert.equal(state.requests[0].snapshot.draft.price, 8000)
assert.equal(p.acceptPreviewRequest(state, 'old', 'forbidden', now), state)
state = p.acceptPreviewRequest(state, 'new', 'order', now)
assert.equal(state.orders.length, 1)
assert.equal(p.acceptPreviewRequest(state, 'new', 'duplicate', now), state)
let order = state.orders[0]
assert.equal(order.expiresAt, now + 1800000)
assert.equal(
  p.transitionPreviewOrder(
    order,
    { type: 'cancel', reason: 'Changed my mind' },
    'seller',
    now
  ).status,
  'cancelled'
)
let released = p.updatePreviewOrder(
  state,
  'order',
  { type: 'cancel', reason: 'Changed my mind' },
  'buyer',
  now
)
assert.equal(released.orders[0].status, 'cancelled')
assert.equal(released.requests[1].status, 'accepted')
assert.equal(
  p.transitionPreviewOrder(order, { type: 'pay' }, 'buyer', order.expiresAt),
  order
)
assert.equal(
  p.transitionPreviewOrder(order, { type: 'expire' }, 'buyer', order.expiresAt)
    .status,
  'expired'
)
order = p.transitionPreviewOrder(order, { type: 'pay' }, 'buyer', now)
assert.equal(
  p.previewStatusLabel(order, 'seller'),
  'Paid / Awaiting fulfillment'
)
assert.equal(order.status, 'paid')
assert.equal(
  p.transitionPreviewOrder(
    order,
    { type: 'cancel', reason: 'No' },
    'buyer',
    now
  ),
  order
)
order = p.transitionPreviewOrder(
  order,
  { type: 'reveal-code', code: '482731' },
  'buyer',
  now
)
assert.equal(order.status, 'paid')
assert.equal(
  p.transitionPreviewOrder(
    order,
    { type: 'verify-code', code: '000000' },
    'seller',
    now
  ),
  order
)
order = p.transitionPreviewOrder(
  order,
  { type: 'verify-code', code: '482731' },
  'seller',
  now
)
assert.equal(order.status, 'protection')
assert.equal(p.previewProgress(order), 3)
assert.equal(order.protectionEndsAt, now + 86400000)
order = p.transitionPreviewOrder(
  order,
  { type: 'issue', reason: 'Safety concern', detail: '' },
  'seller',
  now
)
assert.equal(
  p.transitionPreviewOrder(
    order,
    { type: 'advance-protection' },
    'seller',
    now
  ),
  order
)
state = p.addPreviewRequest(
  state,
  'shipping',
  'shipping-conversation',
  visual('shipping')
)
assert.equal(state.orders[0].snapshot.draft.fulfillment, 'pickup')
assert.equal(
  state.requests.find((value) => value.id === 'new').status,
  'accepted'
)
state = p.acceptPreviewRequest(state, 'shipping', 'ship-order', now)
order = state.orders[1]
assert.equal(p.previewNextStep(order, 'buyer'), 'Add shipping address')
assert.equal(
  p.transitionPreviewOrder(order, { type: 'pay' }, 'buyer', now),
  order
)
assert.equal(
  p.transitionPreviewOrder(order, { type: 'address', address }, 'seller', now),
  order
)
order = p.transitionPreviewOrder(
  order,
  { type: 'address', address },
  'buyer',
  now
)
address.recipient = 'External edit'
assert.equal(order.address.recipient, 'Synthetic Recipient')
order = p.transitionPreviewOrder(order, { type: 'pay' }, 'buyer', now)
assert.equal(
  p.transitionPreviewOrder(
    order,
    { type: 'ship', carrier: 'C', tracking: 'T' },
    'buyer',
    now
  ),
  order
)
order = p.transitionPreviewOrder(
  order,
  { type: 'ship', carrier: 'Canada Post', tracking: 'DEMO-ONLY' },
  'seller',
  now
)
assert.equal(order.status, 'shipped')
assert.equal(p.previewProgress(order), 3)
order = p.transitionPreviewOrder(order, { type: 'deliver' }, 'buyer', now)
assert.equal(order.status, 'delivered')
assert.equal(p.previewProgress(order), 4)
order = p.transitionPreviewOrder(order, { type: 'receive' }, 'buyer', now)
assert.equal(order.status, 'protection')
assert.equal(p.previewProgress(order), 4)
order = p.transitionPreviewOrder(
  order,
  { type: 'advance-protection' },
  'buyer',
  now
)
assert.equal(order.status, 'completed')
assert.equal(p.previewProgress(order), 5)
console.log(
  'PASS staging-only guard; amounts; immutable snapshots; supersession/idempotent accept; both-role unpaid cancellation/buyer-only address; expiry; protected shipping payment; handoff; delivery; issue hold; no network'
)

const pendingVisual = visual('shipping')
pendingVisual.draft.shippingCost = 'arranged'
pendingVisual.draft.shippingFee = null
let pending = p.addPreviewRequest(
  p.emptyInteractionPreview,
  'pending',
  'chat',
  pendingVisual
)
pending = p.acceptPreviewRequest(pending, 'pending', 'pending-order', now)
assert.equal(pending.orders.length, 1)
assert.equal(pending.orders[0].snapshot.draft.shippingFee, null)
assert.equal(
  p.previewNextStep(pending.orders[0], 'buyer'),
  'Shipping cost pending'
)
const withAddress = {
  ...pending.orders[0],
  address: {
    recipient: 'Buyer',
    address: 'Synthetic',
    city: 'London',
    province: 'ON',
    postal: 'N6A 3K7',
    unit: '',
  },
}
const pendingWithAddress = { ...pending, orders: [withAddress] }
assert.equal(
  p.updatePreviewOrder(
    pendingWithAddress,
    'pending-order',
    { type: 'pay' },
    'buyer',
    now
  ).orders[0].status,
  'reserved'
)
console.log(
  'PASS arranged shipping accepts but cannot simulate payment even with address'
)

const timedVisual = visual('pickup')
timedVisual.draft.scheduleMode = 'scheduled'
timedVisual.draft.scheduledAt = now + 30 * 60 * 1000
let timed = p.addPreviewRequest(
  p.emptyInteractionPreview,
  'timed',
  'conversation',
  timedVisual
)
assert.equal(
  p.acceptPreviewRequest(
    timed,
    'timed',
    'expired',
    timedVisual.draft.scheduledAt
  ),
  timed
)
timedVisual.draft.scheduledAt += 86400000
assert.equal(timed.requests[0].snapshot.draft.scheduledAt, now + 30 * 60 * 1000)
assert.equal(
  p.acceptPreviewRequest(timed, 'timed', 'future', now).orders.length,
  1
)
console.log(
  'PASS immutable scheduled timestamp; expired Accept blocked; <1h future Accept allowed'
)

const expiredVisual = visual('pickup')
expiredVisual.draft.scheduledAt = now - 1
let expiredHistory = p.addPreviewRequest(
  p.emptyInteractionPreview,
  'expired-request',
  'expiry-conversation',
  expiredVisual
)
const originalTime = expiredHistory.requests[0].createdAt
expiredHistory = p.addPreviewRequest(
  expiredHistory,
  'new-request',
  'expiry-conversation',
  visual('pickup')
)
assert.equal(expiredHistory.requests[0].status, 'expired')
assert.equal(expiredHistory.requests[0].createdAt, originalTime)
assert.equal(
  p.acceptPreviewRequest(
    expiredHistory,
    'expired-request',
    'invalid-order',
    now
  ),
  expiredHistory
)
console.log(
  'PASS expired request remains expired rather than replaced; unchanged creation timestamp'
)
