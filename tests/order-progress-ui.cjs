const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const m = { exports: {} }
new Function(
  'module',
  'exports',
  ts.transpileModule(fs.readFileSync('lib/order-progress-ui.ts', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
)(m, m.exports)
const derive = m.exports.deriveOrderPresentation
const titles = {
  buyer: [
    'Complete payment',
    'Meet the seller',
    'Complete payment',
    'Waiting for seller to ship',
    'Waiting for shipping quote',
    'Reservation expired',
  ],
  seller: [
    'Waiting for buyer payment',
    'Meet the buyer',
    'Waiting for buyer payment',
    'Ship the item',
    'Set shipping cost',
    'Reservation expired',
  ],
}
let checks = 0
for (const role of ['buyer', 'seller']) {
  for (let i = 0; i < 6; i++) {
    const order = {
      snapshot: {
        draft: { fulfillment: i >= 2 && i < 5 ? 'shipping' : 'pickup' },
      },
      lifecycle: i === 5 ? 'expired' : 'open',
      paymentStatus: i === 1 || i === 3 ? 'paid' : 'pending',
      moneyStatus: i === 4 ? 'shipping_pending' : 'finalized',
      holdsListing: i !== 4 && i !== 5,
      reservationExpiresAt: '2026-10-11T12:00:00Z',
      payoutStatus: 'not_eligible',
    }
    const before = JSON.stringify(order)
    const model = derive(order, role)
    assert.equal(model.title, titles[role][i])
    assert.equal(model.currentStep, i === 1 || i === 3 || i === 5 ? null : 1)
    assert.equal(model.completedSteps, i === 1 || i === 3 ? 2 : 1)
    assert.equal(model.terminal, i === 5)
    assert.equal(model.showReservation, i === 0 || i === 2)
    assert.equal(model.showMeeting, i === 1)
    assert.equal(
      model.steps.length,
      i === 4
        ? role === 'buyer'
          ? 7
          : 6
        : i === 2 || i === 3
        ? role === 'buyer'
          ? 6
          : 5
        : 6
    )
    assert(!model.steps.includes(role === 'buyer' ? 'Payout' : 'Payment'))
    assert.equal(JSON.stringify(order), before)
    assert.deepEqual(derive(order, role), model)
    if (i < 2) {
      order.snapshot.draft.fulfillment = 'meet'
      assert.deepEqual(derive(order, role), model)
    }
    for (const payoutStatus of ['eligible', 'on_hold', 'processing', 'paid'])
      assert.deepEqual(derive({ ...order, payoutStatus }, role), model)
    checks++
  }
}
const source = fs.readFileSync('lib/order-progress-ui.ts', 'utf8')
assert(
  !/visuals\.update|previewPerspective|order-visual-context|useState|fetch\(/.test(
    source
  )
)
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')
const visual = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(fs.readFileSync('components/velora/stepper.tsx', 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText
)(
  (name) => {
    if (name === 'motion/react')
      return {
        useReducedMotion: () => true,
        motion: {
          div: ({ initial, animate, transition, ...props }) =>
            React.createElement('div', props),
        },
      }
    if (name.endsWith('.css')) return { __esModule: true, default: {} }
    return require(name)
  },
  visual,
  visual.exports
)
for (const count of [5, 6, 7]) {
  const steps = Array.from({ length: count }, (_, i) => 'Milestone ' + i)
  const html = renderToStaticMarkup(
    React.createElement(visual.exports.Stepper, {
      steps,
      current: null,
      completed: 2,
      readableMobile: true,
    })
  )
  assert.equal((html.match(/: Completed/g) || []).length, 2)
  assert.equal((html.match(/: Inactive/g) || []).length, count - 2)
  assert(!html.includes('aria-current'))
  assert(html.includes('data-readable-mobile'))
}
const legacy = renderToStaticMarkup(
  React.createElement(visual.exports.Stepper, {
    steps: ['Accepted', 'Payment', 'Later'],
    current: 1,
  })
)
assert(legacy.includes('Payment: Current'))
assert(legacy.includes('Accepted: Completed'))
assert(!legacy.includes('data-readable-mobile'))
console.log(
  'PASS ' +
    checks +
    ' role/fulfillment/state mappings, Meet parity, variable counts, immutability, no payout/future progression or private account data'
)
