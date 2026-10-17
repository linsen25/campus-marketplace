const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const moduleUnderTest = { exports: {} }
const code = ts.transpileModule(
  fs.readFileSync('lib/shop-presentation.ts', 'utf8'),
  {
    compilerOptions: { module: 1, target: 7 },
  }
).outputText
new Function('exports', code)(moduleUnderTest.exports)
const { shopIdentityError, shopPath } = moduleUnderTest.exports
const identity = {
  shopName: 'Vintage Loop',
  category: 'Clothing & Accessories',
  description:
    'Curated vintage clothing, sneakers and accessories around campus.',
}
assert.equal(shopIdentityError(identity), '')
for (const invalid of [
  { shopName: ' ' },
  { shopName: 'a'.repeat(41) },
  { category: 'unknown' },
  { description: ' ' },
  { description: 'a'.repeat(201) },
])
  assert(shopIdentityError({ ...identity, ...invalid }))
assert.equal(
  shopIdentityError({
    ...identity,
    shopName: 'a'.repeat(40),
    description: 'a'.repeat(200),
  }),
  ''
)
assert.equal(shopPath('demo_seller_a'), '/shop/demo_seller_a')
assert.equal(shopPath('demo_seller_updated'), '/shop/demo_seller_updated')
assert.deepEqual(identity, {
  shopName: 'Vintage Loop',
  category: 'Clothing & Accessories',
  description:
    'Curated vintage clothing, sneakers and accessories around campus.',
})
console.log(
  'PASS Shop identity bounds, category validation, derived handle URL and immutable input'
)
