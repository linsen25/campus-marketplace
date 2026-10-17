const fs = require('node:fs')
const assert = require('node:assert/strict')
const ts = require('typescript')
const moduleUnderTest = { exports: {} }
new Function(
  'module',
  'exports',
  ts.transpileModule(fs.readFileSync('lib/order-current-step.ts', 'utf8'), {
    fileName: 'lib/order-current-step.ts',
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
)(moduleUnderTest, moduleUnderTest.exports)
const { currentOrderStep, currentOrderProgress } = moduleUnderTest.exports
const order = {
  lifecycle: 'open',
  paymentStatus: 'pending',
  v2: { terms: { fulfillment: 'on_campus' } },
  campusPayment: { inspectionConfirmedAt: null },
}
const data = {
  fulfillment: {
    handoffReady: false,
    handoffConfirmedAt: null,
    protectionStartedAt: null,
  },
  courier: null,
  checkout: null,
}
assert.equal(currentOrderStep(order, data, false), 'review')
assert.equal(currentOrderStep(order, data, true), 'review')
assert.equal(currentOrderProgress(order, data).completed, 0)
data.fulfillment.agreement = { complete: true }
assert.equal(currentOrderStep(order, data), 'payment')
assert.equal(currentOrderProgress(order, data).current, 1)
assert.equal(currentOrderProgress(order, data).completed, 1)
for (const paymentStatus of ['processing', 'paid']) {
  const value = { ...order, paymentStatus }
  assert.equal(
    currentOrderStep(value, data, false),
    paymentStatus === 'paid' ? 'handoff' : 'payment'
  )
}
assert.equal(
  currentOrderStep(
    {
      ...order,
      campusPayment: { inspectionConfirmedAt: '2026-10-14T12:00:00Z' },
    },
    data,
    false
  ),
  'payment'
)
for (const deliveryMethod of ['courier', 'seller_delivery']) {
  const value = {
    ...order,
    v2: { terms: { fulfillment: 'delivery', deliveryMethod } },
  }
  assert.equal(currentOrderStep(value, data, true), 'checkout')
  assert.equal(
    currentOrderStep({ ...value, paymentStatus: 'paid' }, data, false),
    deliveryMethod === 'courier' ? 'shipment' : 'delivery'
  )
  const protectedState = {
    ...data,
    fulfillment: {
      ...data.fulfillment,
      protectionStartedAt: '2026-10-14T12:00:00Z',
    },
  }
  assert.equal(
    currentOrderStep(
      { ...value, paymentStatus: 'paid' },
      protectedState,
      false
    ),
    'protection'
  )
  assert.equal(
    currentOrderProgress({ ...value, paymentStatus: 'paid' }, data).completed,
    2
  )
}
for (const lifecycle of ['cancelled', 'expired', 'completed']) {
  assert.equal(
    currentOrderStep({ ...order, lifecycle }, null, false),
    lifecycle
  )
  const progress = currentOrderProgress({ ...order, lifecycle }, data)
  assert.equal(progress.current, null)
  assert.equal(progress.completed, lifecycle === 'completed' ? 6 : 1)
}
const paid = { ...order, paymentStatus: 'paid' }
assert.equal(currentOrderProgress(paid, data).current, 2)
assert.equal(currentOrderProgress(paid, data).completed, 2)
assert.equal(currentOrderStep(paid, null, true), 'loading')
assert.equal(
  currentOrderStep({ ...order, paymentStatus: 'refunded' }, data, false),
  'payment'
)
assert.equal(
  currentOrderProgress(
    {
      ...paid,
      v2: { terms: { fulfillment: 'delivery', deliveryMethod: 'courier' } },
    },
    { ...data, courier: { shippedAt: '2026-10-14T12:00:00Z' } }
  ).completed,
  3
)
assert.deepEqual(order, {
  lifecycle: 'open',
  paymentStatus: 'pending',
  v2: { terms: { fulfillment: 'on_campus' } },
  campusPayment: { inspectionConfirmedAt: null },
})
console.log(
  'PASS authoritative Review/payment-before-inspection/handoff/Delivery/Courier/Protection/terminal mapping; local review excluded from Stepper; future stages never falsely completed; immutable inputs'
)

assert.equal(
  currentOrderStep(
    { ...order, paymentStatus: 'processing' },
    {
      ...data,
      fulfillment: {
        ...data.fulfillment,
        cancellation: { state: 'payment_pending' },
      },
    },
    true
  ),
  'cancellation'
)
assert.equal(
  currentOrderProgress(
    { ...order, paymentStatus: 'processing' },
    {
      ...data,
      fulfillment: {
        ...data.fulfillment,
        cancellation: { state: 'payment_pending' },
      },
    }
  ).current,
  null
)

const external = {
  ...order,
  v2: { terms: { fulfillment: 'on_campus', paymentMode: 'external' } },
}
const externalData = {
  fulfillment: {
    agreement: { complete: true },
    externalExchange: { status: 'awaiting_both' },
  },
}
assert.equal(currentOrderStep(external, externalData), 'exchange')
assert.deepEqual(currentOrderProgress(external, externalData).steps, [
  'Agreement',
  'Meet / Inspect',
  'Confirm exchange',
  'Completed',
])
assert.equal(currentOrderProgress(external, externalData).completed, 1)
externalData.fulfillment.externalExchange.status = 'buyer_confirmed'
assert.equal(currentOrderProgress(external, externalData).current, 2)
externalData.fulfillment.externalExchange.status = 'disputed'
assert.equal(currentOrderProgress(external, externalData).current, 2)
assert.equal(
  currentOrderProgress({ ...external, lifecycle: 'completed' }, externalData)
    .completed,
  4
)
console.log(
  'PASS external progress has no Payment/Handoff/Protection stages; one confirmation does not complete'
)
