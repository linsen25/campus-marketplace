// Isolated presentational amount helper; no network, accounts or payment behavior.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const source = fs.readFileSync('lib/order-visual-preview.ts', 'utf8')
const result = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
)(() => ({ formatListingPrice: () => '' }), result, result.exports)
const calculate = result.exports.calculateOrderVisualAmounts
assert.deepEqual(calculate(8000, 1000), {
  item: 8000,
  shipping: 1000,
  serviceFee: 360,
  sellerFee: 0,
  total: 9360,
})
assert.equal(calculate(100).serviceFee, 100)
assert.equal(calculate(75000).serviceFee, 1500)
assert.equal(calculate(3333).serviceFee, 133)
assert.equal(calculate(8000, 10000).serviceFee, 720)
for (const amount of [-1, NaN, Infinity, 0.5, Number.MAX_SAFE_INTEGER + 1])
  assert.throws(() => calculate(amount), RangeError)
assert.throws(() => calculate(Number.MAX_SAFE_INTEGER, 1), RangeError)
console.log(
  'PASS preview protected-subtotal fee minimum/cap/rounding, shipping inclusion, seller zero, invalid amounts; no network'
)

const requestAmounts = result.exports.calculateOrderRequestVisualAmounts
const draft = {
  price: 8000,
  fulfillment: 'shipping',
  shippingCost: 'flat',
  shippingFee: 1000,
}
assert.equal(requestAmounts(draft).total, 9360)
assert.equal(
  requestAmounts({ ...draft, shippingCost: 'included', shippingFee: 0 }).total,
  8320
)
assert.equal(
  requestAmounts({ ...draft, shippingCost: 'arranged', shippingFee: null }),
  null
)
assert.throws(() => requestAmounts({ ...draft, shippingFee: null }), RangeError)
console.log(
  'PASS shipping included/flat protected subtotal; arranged returns no payable total'
)
