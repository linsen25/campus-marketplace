const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  ts = require('typescript'),
  React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
const cache = {}
function load(file, resolve) {
  if (cache[file]) return cache[file]
  const m = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
    }).outputText
  )(resolve, m, m.exports)
  return (cache[file] = m.exports)
}
const schedule = load('lib/order-schedule-preview.ts', () => {})
const domain = load('lib/order-interaction-preview.ts', () => schedule)
const presentation = load('lib/order-presentation-preview.ts', () => domain)
const now = Date.UTC(2026, 9, 10, 12),
  snapshot = {
    listing: { id: 'fixture', title: 'Fixture' },
    draft: {
      fulfillment: 'pickup',
      scheduleMode: 'scheduled',
      scheduledAt: now + 86400000,
      price: 8000,
    },
    buyerId: 'buyer',
    sellerId: 'seller',
  }
let state = domain.addPreviewRequest(
  domain.emptyInteractionPreview,
  'a',
  'conversation',
  snapshot,
  { createdAt: new Date(now).toISOString() }
)
const cancelRequest = (state, id, role, now) =>
  domain.cancelPreviewRequest(state, id, {
    role,
    reason: 'Sent by mistake',
    note: 'Local note',
    now,
  })
const original = state.requests[0]
assert.strictEqual(cancelRequest(state, 'a', 'buyer', now), state)
state = cancelRequest(state, 'a', 'seller', now)
assert.equal(state.requests[0].status, 'cancelled')
assert.strictEqual(state.requests[0].snapshot, original.snapshot)
assert.equal(state.requests[0].createdAt, original.createdAt)
assert.equal(state.orders.length, 0)
assert.strictEqual(cancelRequest(state, 'a', 'seller', now), state)
assert.strictEqual(domain.acceptPreviewRequest(state, 'a', 'order', now), state)
state = domain.addPreviewRequest(state, 'b', 'conversation', snapshot, {
  createdAt: new Date(now + 1).toISOString(),
})
assert.deepEqual(
  state.requests.map((r) => r.status),
  ['cancelled', 'active']
)
assert.equal(
  domain.expirePreviewRequests(state, now + 86400000).requests[0].status,
  'cancelled'
)
for (const terminal of ['superseded', 'accepted', 'expired', 'cancelled']) {
  const s = { ...state, requests: [{ ...state.requests[1], status: terminal }] }
  assert.strictEqual(cancelRequest(s, 'b', 'seller', now), s)
}
const order = {
  id: 'order',
  requestId: 'b',
  snapshot,
  status: 'reserved',
  expiresAt: now + 1800000,
}
assert.equal(
  presentation.getOrderPreviewPresentation(order, 'buyer').title,
  'Complete payment'
)
assert.equal(
  presentation.getOrderPreviewPresentation(order, 'seller').title,
  'Buyer payment pending'
)
const protection = {
  ...order,
  status: 'protection',
  protectionEndsAt: now + 86400000,
}
assert.equal(
  presentation.getOrderPreviewPresentation(protection, 'buyer').title,
  'Marketplace Protection'
)
assert.equal(
  presentation.getOrderPreviewPresentation(protection, 'seller').title,
  'Payout pending'
)
assert.match(
  presentation.getOrderPreviewPresentation(
    { ...order, status: 'completed' },
    'seller'
  ).description,
  /No real payout/
)
assert.equal(
  presentation.getOrderPreviewPresentation(
    { ...order, status: 'completed' },
    'buyer'
  ).title,
  'Purchase completed'
)
assert.equal(
  presentation.getOrderPreviewPresentation(
    { ...order, status: 'protection', issue: {} },
    'seller'
  ).title,
  'Order on hold'
)
assert.equal(
  presentation.formatOrderCountdown(now + 1799000, now, false),
  '29:59'
)
assert.equal(
  presentation.formatOrderCountdown(now + 86382000, now, true),
  '23h 59m 42s'
)
assert.equal(
  presentation.formatOrderCountdown(now - 1000, now, true),
  '0h 00m 00s'
)
assert.equal(
  presentation.formatOrderCountdown(now + 86344000, now, true),
  '23h 59m 04s'
)
assert.equal(
  presentation.formatOrderCountdown(now + 26 * 3600000, now, true),
  '26h 00m 00s'
)
assert.equal(
  presentation.formatOrderCountdown(now + 1000, now, true),
  '0h 00m 01s'
)
const copy = JSON.stringify(order)
for (let i = 0; i < 60; i++)
  presentation.formatOrderCountdown(order.expiresAt, now + i * 1000, false)
assert.equal(JSON.stringify(order), copy)
const clock = load('components/home/order-countdown.tsx', (name) =>
  name.startsWith('@/') ? presentation : require(name)
)
assert(
  renderToStaticMarkup(
    React.createElement(clock.OrderCountdown, { expiresAt: Date.now() + 10000 })
  ).includes('data-order-countdown="reservation"')
)
assert(
  !fs
    .readFileSync('components/home/order-countdown.tsx', 'utf8')
    .includes('visuals.update')
)
const skeleton = load('components/home/order-loading.tsx', (name) =>
  name.endsWith('.css')
    ? { __esModule: true, default: {} }
    : name.endsWith('/skeleton')
    ? {
        Skeleton: () => React.createElement('div', { 'data-slot': 'skeleton' }),
      }
    : require(name)
)
const listLoading = renderToStaticMarkup(
  React.createElement(skeleton.OrderListSkeleton)
)
assert(listLoading.includes('aria-label="Loading orders"'))
assert.equal((listLoading.match(/<article/g) || []).length, 4)
for (const card of listLoading.matchAll(/<article[^>]*>([\s\S]*?)<\/article>/g))
  assert((card[1].match(/data-slot="skeleton"/g) || []).length >= 4)
const detailLoading = renderToStaticMarkup(
  React.createElement(skeleton.OrderDetailSkeleton)
)
assert(detailLoading.includes('aria-label="Loading order details"'))
assert((detailLoading.match(/data-slot="skeleton"/g) || []).length >= 10)
assert(!/Loading\.\.\.|No orders yet/.test(detailLoading))
console.log(
  'PASS seller-only terminal cancellation/new snapshot; immutable chronology; role guidance; countdown expiry/clamping/presentation-only; existing Skeleton readiness'
)

assert.equal(state.events.length, 1)
assert(Object.isFrozen(state.requests[0].cancellation))
for (const role of ['buyer', 'seller']) {
  let active = domain.addPreviewRequest(
    domain.emptyInteractionPreview,
    'request-' + role,
    'conversation',
    snapshot,
    { createdAt: new Date(now).toISOString() }
  )
  active = domain.acceptPreviewRequest(
    active,
    'request-' + role,
    'order-' + role,
    now
  )
  const cancelled = domain.updatePreviewOrder(
    active,
    'order-' + role,
    { type: 'cancel', reason: 'Cannot meet', note: 'Changed plan' },
    role,
    now + 1000
  )
  assert.equal(cancelled.orders[0].status, 'cancelled')
  assert.equal(cancelled.requests[0].status, 'accepted')
  assert.equal(cancelled.events.length, 1)
  assert(Object.isFrozen(cancelled.orders[0].cancellation))
  assert.equal(
    domain.updatePreviewOrder(
      cancelled,
      'order-' + role,
      { type: 'cancel', reason: 'Other' },
      role,
      now + 2000
    ).events.length,
    1
  )
  const paid = domain.updatePreviewOrder(
    active,
    'order-' + role,
    { type: 'pay' },
    'buyer',
    now
  )
  const rejected = domain.updatePreviewOrder(
    paid,
    'order-' + role,
    { type: 'cancel', reason: 'Other' },
    role,
    now + 1000
  )
  assert.equal(rejected.orders[0].status, 'paid')
  assert.equal((rejected.events || []).length, 0)
}
console.log(
  'PASS reason snapshots; one cancellation event; Buyer/Seller pre-payment cancellation; Accepted request unchanged; both roles blocked after payment'
)

let pair = domain.addPreviewRequest(
  domain.emptyInteractionPreview,
  'buyer-a',
  'conversation-a',
  snapshot,
  { createdAt: new Date(now).toISOString() }
)
pair = domain.addPreviewRequest(
  pair,
  'buyer-b',
  'conversation-b',
  { ...snapshot, buyerId: 'other' },
  { createdAt: new Date(now).toISOString() }
)
const other = pair.requests[1]
pair = domain.cancelPreviewRequest(pair, 'buyer-a', {
  role: 'seller',
  reason: 'Sent by mistake',
  now: now + 1000,
})
assert.strictEqual(pair.requests[1], other)
assert.equal(pair.events.length, 1)
assert.strictEqual(
  domain.cancelPreviewRequest(pair, 'buyer-a', {
    role: 'seller',
    reason: 'Other',
    now: now + 2000,
  }),
  pair
)
assert.equal(pair.events.length, 1)
console.log(
  'PASS cancellation scope isolates other buyer; duplicate request cancellation produces exactly one event'
)

let orderPair = domain.addPreviewRequest(
  domain.emptyInteractionPreview,
  'order-buyer-a',
  'conversation-a',
  snapshot,
  { createdAt: new Date(now).toISOString() }
)
orderPair = domain.addPreviewRequest(
  orderPair,
  'order-buyer-b',
  'conversation-b',
  { ...snapshot, buyerId: 'other' },
  { createdAt: new Date(now).toISOString() }
)
const unaffected = orderPair.requests[1]
orderPair = domain.acceptPreviewRequest(
  orderPair,
  'order-buyer-a',
  'scope-order',
  now
)
orderPair = domain.updatePreviewOrder(
  orderPair,
  'scope-order',
  { type: 'cancel', reason: 'Item is no longer available' },
  'seller',
  now + 1000
)
assert.strictEqual(orderPair.requests[1], unaffected)
assert.equal(orderPair.events[0].conversationId, 'conversation-a')
console.log(
  'PASS Order cancellation leaves another buyer negotiation unchanged and scopes its event to the original conversation'
)
