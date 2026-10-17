const fs = require('node:fs')
const assert = require('node:assert/strict')
const ts = require('typescript')
function load(file) {
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }).outputText
  )((name) => load(name.replace('@/', '') + '.ts'), module, module.exports)
  return module.exports
}
const { orderNumber, orderPresentation } = load('lib/order-presentation.ts')
assert.equal(
  orderNumber('fda25a07-1c57-483e-93f1-2ae81b39b6c7'),
  'FDA25A071C57483E93F12AE81B39B6C7'
)
assert.equal(orderNumber('invalid'), null)
for (const mode of ['campus', 'seller_delivery', 'courier']) {
  const order = {
    id: 'fixture',
    lifecycle: 'open',
    paymentStatus: 'pending',
    v2: {
      terms:
        mode === 'campus'
          ? { fulfillment: 'on_campus' }
          : { fulfillment: 'delivery', deliveryMethod: mode },
    },
  }
  const data = {
    fulfillment: {
      handoffReady: false,
      protectionStartedAt: null,
      deliveryStartedAt: null,
    },
    checkout: null,
    courier: null,
  }
  const before = JSON.stringify(order)
  assert.equal(orderPresentation(order, data).maximum, 0)
  assert.equal(orderPresentation(order, data).current, 0)
  data.fulfillment.agreement = {
    complete: false,
    buyerConfirmedAt: 'server-time',
    sellerConfirmedAt: null,
  }
  assert.equal(
    orderPresentation(order, data).maximum,
    0,
    'One actor is insufficient'
  )
  data.fulfillment.agreement = {
    complete: true,
    buyerConfirmedAt: 'server-time',
    sellerConfirmedAt: 'server-time',
  }
  assert.equal(orderPresentation(order, data).current, 1)
  assert.equal(JSON.stringify(order), before)
  order.paymentStatus = 'processing'
  assert.equal(orderPresentation(order, data).current, 1)
  assert.equal(orderPresentation(order, data).maximum, 1)
  order.paymentStatus = 'paid'
  data.fulfillment.handoffReady = true
  assert.equal(orderPresentation(order, data).current, 2)
  if (mode === 'campus') assert.equal(orderPresentation(order, data).maximum, 2)
  else {
    assert.equal(orderPresentation(order, data).maximum, 2)
    if (mode === 'courier') data.courier = { shippedAt: 'server-time' }
    else data.fulfillment.deliveryStartedAt = 'server-time'
    assert.equal(orderPresentation(order, data).current, 3)
  }
  data.fulfillment.protectionStartedAt = 'server-time'
  assert.equal(orderPresentation(order, data).maximum, 4)
  order.lifecycle = 'completed'
  assert.equal(orderPresentation(order, data).current, 5)
}
console.log(
  'PASS Order view bounds: deterministic UUID reference, unpaid/processing block fulfillment, paid/started/shipped/protection/completed bounds, no data mutation.'
)

const independent = {
  id: 'external',
  lifecycle: 'open',
  paymentStatus: 'pending',
  v2: { terms: { fulfillment: 'on_campus', paymentMode: 'external' } },
}
const independentData = {
  fulfillment: {
    agreement: { complete: true },
    externalExchange: { status: 'awaiting_both' },
  },
}
assert.deepEqual(orderPresentation(independent, independentData), {
  pages: ['review', 'fulfillment', 'exchange', 'completed'],
  current: 1,
  maximum: 2,
})
independentData.fulfillment.externalExchange.status = 'seller_confirmed'
assert.equal(orderPresentation(independent, independentData).current, 2)
assert.equal(
  orderPresentation({ ...independent, lifecycle: 'completed' }, independentData)
    .current,
  3
)
console.log('PASS external presentation bounds and exact four-page flow')
