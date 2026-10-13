const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const cache = new Map()
let view
let orderView = 'active'
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name.endsWith('.css'))
        return {
          __esModule: true,
          default: new Proxy({}, { get: (_, key) => String(key) }),
        }
      if (name === 'next/router')
        return {
          useRouter: () => ({
            query: { section: 'orders', destination: 'purchases', orderView },
            push: async () => {},
          }),
        }
      if (name === '@/hooks/use-formal-orders')
        return { useFormalOrders: () => view }
      if (name === './order-request-preview')
        return {
          OrderVisualTerms: () =>
            React.createElement('p', null, 'immutable terms'),
        }
      if (name === './formal-order-payment')
        return {
          FormalOrderPayment: () =>
            React.createElement('div', { 'data-active-payment': true }),
        }
      if (name === './order-progress')
        return {
          OrderProgress: () =>
            React.createElement('div', { 'data-active-progress': true }),
        }
      if (name === './order-cancellation')
        return { OrderCancellation: () => null }
      if (name === './order-countdown')
        return {
          OrderCountdown: () =>
            React.createElement('span', { 'data-active-countdown': true }),
        }
      if (name.startsWith('@/') || name.startsWith('.')) {
        const stem = name.startsWith('@/')
          ? path.resolve(name.slice(2))
          : path.resolve(path.dirname(full), name)
        return load(stem + (fs.existsSync(stem + '.tsx') ? '.tsx' : '.ts'))
      }
      return require(name)
    },
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
const { terminalOrderOutcome, orderStatusLabel } = load(
  'lib/order-terminal-presentation.ts'
)
assert.equal(terminalOrderOutcome('expired'), 'Expired')
assert.equal(terminalOrderOutcome('cancelled'), 'Cancelled')
assert.equal(terminalOrderOutcome('open'), null)
assert.equal(terminalOrderOutcome(), null)
const order = {
  id: 'o',
  requestId: 'r',
  buyerId: 'b',
  sellerId: 's',
  lifecycle: 'expired',
  paymentStatus: 'pending',
  moneyStatus: 'finalized',
  holdsListing: false,
  itemAmount: 8000,
  shippingAmount: 0,
  serviceFee: 320,
  totalAmount: 8320,
  acceptedAt: '2026-10-11T09:10:31Z',
  expiredAt: '2026-10-11T09:41:17Z',
  reservationExpiresAt: '2026-10-11T09:40:31Z',
  snapshot: {
    listing: { title: 'Nike', photoUrls: [] },
    buyer: 'Buyer',
    seller: 'Seller',
    draft: {
      price: 8000,
      fulfillment: 'pickup',
      location: 'Campus',
      scheduleMode: 'tbd',
    },
  },
}
const { FormalOrderDetail } = load('components/home/formal-order-detail.tsx')
for (const role of ['buyer', 'seller'])
  for (const lifecycle of ['expired', 'cancelled', 'open']) {
    const current = { ...order, lifecycle, holdsListing: lifecycle === 'open' }
    const html = renderToStaticMarkup(
      React.createElement(FormalOrderDetail, {
        order: current,
        userId: role === 'buyer' ? 'b' : 's',
        offset: 0,
        mode: role === 'buyer' ? 'purchases' : 'sales',
        onBack: () => {},
        onRefresh: async () => {},
        onCancelled: () => {},
      })
    )
    assert.equal(html.includes('aria-label="Next Step"'), lifecycle === 'open')
    assert.equal(html.includes('data-active-progress'), lifecycle === 'open')
    assert.equal(html.includes('data-active-countdown'), lifecycle === 'open')
    if (lifecycle !== 'open') {
      assert(html.includes('No payment was completed.'))
      assert(html.includes('Request status'))
      assert(html.includes('Accepted'))
      assert(!html.includes('data-active-payment'))
    }
  }
assert.equal(
  orderStatusLabel({ ...order, paymentStatus: 'pending', lifecycle: 'open' }),
  'Reserved / Payment pending'
)
assert.equal(
  orderStatusLabel({ ...order, paymentStatus: 'paid', lifecycle: 'open' }),
  'Payment paid'
)
view = {
  data: {
    orders: [
      order,
      { ...order, id: 'cancelled', lifecycle: 'cancelled' },
      { ...order, id: 'active', lifecycle: 'open' },
    ],
  },
  userId: 'b',
  loading: false,
  offset: 0,
  refresh: async () => {},
}
const { FormalOrders } = load('components/home/formal-orders.tsx')
let html = renderToStaticMarkup(
  React.createElement(FormalOrders, { mode: 'purchases' })
)
assert(!html.includes('data-order-list-card="cancelled"'))
assert.equal((html.match(/View Order/g) || []).length, 1)
orderView = 'history'
html = renderToStaticMarkup(
  React.createElement(FormalOrders, { mode: 'purchases' })
)
assert(html.includes('data-order-list-card="cancelled"'))
assert.equal((html.match(/View details/g) || []).length, 2)
assert.equal((html.match(/View Order/g) || []).length, 0)
const requestSource = fs.readFileSync(
  'components/home/order-request-preview.tsx',
  'utf8'
)
assert(requestSource.includes("request.status === 'accepted'"))
assert(/requestCardStatus\(\s*request.status/.test(requestSource))
assert(requestSource.includes('<dt>Order outcome</dt>'))
assert(!requestSource.includes('paymentMethod'))
const { requestCardStatus } = load('lib/request-card-status.ts')
for (const [status, label] of Object.entries({
  active: 'Active',
  superseded: 'Replaced',
  cancelled: 'Cancelled',
  expired: 'Expired',
})) {
  assert.equal(requestCardStatus(status).primary, label)
  assert.equal(requestCardStatus(status).secondary, null)
}
for (const [lifecycle, label, tone] of [
  ['open', 'Accepted', 'success'],
  ['expired', 'Order expired', 'muted'],
  ['cancelled', 'Order cancelled', 'destructive'],
  ['completed', 'Completed', 'success'],
]) {
  const input = Object.freeze({ lifecycle, paymentStatus: 'pending' })
  const result = requestCardStatus('accepted', input)
  assert.equal(result.primary, label)
  assert.equal(result.tone, tone)
  assert.equal(
    result.secondary,
    lifecycle === 'open' ? null : 'Request accepted'
  )
  assert.equal(input.lifecycle, lifecycle)
}
assert.deepEqual(
  requestCardStatus('accepted', {
    lifecycle: 'open',
    paymentStatus: 'refunded',
  }),
  {
    primary: 'Refunded',
    secondary: 'Request accepted',
    outcome: 'Refunded',
    tone: 'neutral',
  }
)
assert.equal(
  requestCardStatus('active', { lifecycle: 'expired' }).primary,
  'Active'
)
console.log(
  'PASS terminal detail/list rendering, Request primary/secondary/tone priorities including Completed/Refunded, immutable inputs, both roles, active controls and no pre-Accept payment gate'
)

const { deriveOrderListBucket, filterOrderList } = load(
  'lib/order-list-presentation.ts'
)
for (const lifecycle of ['open', 'fulfilling', 'protection', 'disputed']) {
  assert.equal(
    deriveOrderListBucket({ ...order, lifecycle, payoutStatus: 'on_hold' }),
    'active'
  )
}
for (const lifecycle of ['expired', 'cancelled', 'completed', 'refunded'])
  assert.equal(deriveOrderListBucket({ ...order, lifecycle }), 'history')
assert.equal(
  deriveOrderListBucket({
    ...order,
    lifecycle: 'open',
    paymentStatus: 'refunded',
  }),
  'history'
)
const historical = Object.freeze([
  Object.freeze({ ...order, id: 'old', createdAt: '2026-10-10T00:00:00Z' }),
  Object.freeze({
    ...order,
    id: 'new',
    lifecycle: 'cancelled',
    cancellation: { at: '2026-10-12T00:00:00Z' },
  }),
  Object.freeze({ ...order, id: 'active', lifecycle: 'open' }),
])
assert.deepEqual(
  filterOrderList(historical, 'history').map((o) => o.id),
  ['new', 'old']
)
assert.deepEqual(
  filterOrderList(historical, 'active').map((o) => o.id),
  ['active']
)
assert(!requestSource.includes('<dt>Cancelled by</dt>'))
assert(!requestSource.includes('<dt>Cancelled at</dt>'))
console.log(
  'PASS Active/History classification, authoritative terminal sorting, immutable source, same-listing IDs, concise Request terms'
)

const futureHistory = [
  {
    ...order,
    id: 'completed',
    lifecycle: 'completed',
    completedAt: '2026-10-13T00:00:00Z',
  },
  {
    ...order,
    id: 'refunded',
    lifecycle: 'open',
    paymentStatus: 'refunded',
    refundedAt: '2026-10-14T00:00:00Z',
  },
  {
    ...order,
    id: 'fallback',
    lifecycle: 'expired',
    expiredAt: null,
    createdAt: '2026-10-15T00:00:00Z',
  },
]
assert.deepEqual(
  filterOrderList(futureHistory, 'history').map((o) => o.id),
  ['fallback', 'refunded', 'completed']
)
assert.deepEqual(
  filterOrderList(historical, 'active').map((o) => o.id),
  ['active']
)
console.log(
  'PASS future Completed/Refunded terminal timestamp fixtures and authoritative creation fallback; no lifecycle mutation'
)
