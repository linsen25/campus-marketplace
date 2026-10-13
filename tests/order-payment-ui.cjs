const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
const React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
let state = { data: null, error: '', loading: true, refresh: async () => {} }
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/hooks/use-financial-capabilities')
        return { useFinancialCapabilities: () => state }
      if (name.endsWith('.css'))
        return {
          __esModule: true,
          default: new Proxy({}, { get: (_, p) => String(p) }),
        }
      if (name === 'next/router')
        return { useRouter: () => ({ push: async () => {} }) }
      if (name.startsWith('@/'))
        return load(
          name.slice(2) +
            (name.startsWith('components/') || name.startsWith('@/components/')
              ? '.tsx'
              : '.ts')
        )
      if (name.startsWith('.'))
        return load(
          path.resolve(path.dirname(full), name) +
            (fs.existsSync(path.resolve(path.dirname(full), name) + '.tsx')
              ? '.tsx'
              : '.ts')
        )
      return require(name)
    },
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}

const { FormalOrderPayment } = load('components/home/formal-order-payment.tsx')
const { stagingPaymentControl, orderPaymentRole } = load(
  'lib/order-payment-ui.ts'
)
const order = {
  id: 'o',
  buyerId: 'b',
  sellerId: 's',
  lifecycle: 'open',
  moneyStatus: 'finalized',
  paymentStatus: 'pending',
  payoutStatus: 'not_eligible',
  paymentPaidAt: null,
  holdsListing: true,
  reservationExpiresAt: new Date(Date.now() + 1800000).toISOString(),
  itemAmount: 8000,
  shippingAmount: 1000,
  serviceFee: 360,
  totalAmount: 9360,
}
function render(userId = 'b', value = order) {
  return renderToStaticMarkup(
    React.createElement(FormalOrderPayment, {
      order: value,
      userId,
      offset: 0,
      onRefresh: async () => {},
    })
  )
}
process.env.NEXT_PUBLIC_MESSAGES_ENV = 'staging'
process.env.NEXT_PUBLIC_SUPABASE_URL =
  'https://pcaqxezdfxofysghssyo.supabase.co'
state = {
  loading: false,
  error: '',
  refresh: async () => {},
  data: {
    paymentMethod: { status: 'set', brand: 'Visa', last4: '4242' },
    payoutAccount: { status: 'ready', institution: 'Own Bank', last4: '6789' },
  },
}
let html = render()
assert(html.includes('Payment pending'))
assert(html.includes('93.60'))
assert(html.includes('3.60'))
assert(html.includes('Visa \u2022\u2022\u2022\u2022 4242'))
assert(html.includes('Simulate successful payment'))
assert(!html.includes('Payout account'))
assert(!html.includes('6789'))
assert(!html.includes('Expected payout'))
for (const status of ['unset', 'needs_attention']) {
  state.data.paymentMethod.status = status
  html = render()
  assert(html.includes('Manage payment method'))
  assert(html.includes('disabled=""'))
}
state.data.paymentMethod.status = 'set'
html = render('s')
assert(html.includes('Waiting for buyer payment'))
assert(html.includes('Expected payout'))
assert(/Expected payout<\/dt><dd>[^<]*90<\/dd>/.test(html))
assert(html.includes('Not eligible yet'))
assert(html.includes('Own Bank \u2022\u2022\u2022\u2022 6789'))
assert(!html.includes('4242'))
assert(!html.includes('Payment method'))
assert(!html.includes('Simulate successful payment'))
state.data.payoutAccount.status = 'needs_attention'
assert(render('s').includes('Review Payout Settings'))
for (const user of ['b', 's']) {
  html = render(user, {
    ...order,
    paymentStatus: 'paid',
    paymentPaidAt: '2026-10-11T12:00:00Z',
  })
  assert(
    html.includes(
      user === 'b' ? 'Payment confirmed' : 'Buyer payment confirmed'
    )
  )
  assert(html.includes('Paid at'))
  assert(!html.includes('reservation remaining'))
  assert(!html.includes('Simulate successful payment'))
}
for (const user of ['b', 's']) {
  html = render(user, {
    ...order,
    moneyStatus: 'shipping_pending',
    shippingAmount: null,
    serviceFee: null,
    totalAmount: null,
    holdsListing: false,
    reservationExpiresAt: null,
  })
  assert(html.includes('Shipping cost pending'))
  assert(!html.includes('<dt>Total</dt>'))
  assert(!html.includes('<dt>Order total</dt>'))
  assert(!html.includes('Simulate successful payment'))
  html = render(user, { ...order, lifecycle: 'expired', holdsListing: false })
  assert(html.includes('Reservation expired'))
  assert(!html.includes('Simulate successful payment'))
  assert(!html.includes('reservation remaining'))
}
for (const paymentStatus of ['processing', 'failed', 'refunded'])
  assert(
    !render('b', { ...order, paymentStatus }).includes(
      'Simulate successful payment'
    )
  )
for (const [env, url] of [
  ['production', 'https://yzvchumzyonegujucyqs.supabase.co'],
  ['staging', 'https://yzvchumzyonegujucyqs.supabase.co'],
  ['production', 'https://pcaqxezdfxofysghssyo.supabase.co'],
  ['unknown', 'https://pcaqxezdfxofysghssyo.supabase.co'],
]) {
  process.env.NEXT_PUBLIC_MESSAGES_ENV = env
  process.env.NEXT_PUBLIC_SUPABASE_URL = url
  assert(!render().includes('STAGING ONLY'))
  assert(!stagingPaymentControl(order, 'b'))
}
assert.equal(orderPaymentRole(order, 'x'), null)
assert(!render('x').includes('4242'))
state.data = null
state.loading = true
assert(render().includes('data-slot="skeleton"'))
state.loading = false
state.error = 'Unable to load'
assert(!render().includes('data-slot="skeleton"'))
assert(render().includes('Retry account status'))
console.log(
  'PASS role-specific money/account privacy, Set/Unset/attention, Paid/shipping/expired/future UI, exact production/staging guards and loading/error states'
)
