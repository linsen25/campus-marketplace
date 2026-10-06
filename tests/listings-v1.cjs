const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'exports', code)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    exports
  )
  cache.set(full, exports)
  return exports
}
const { validateBuilder, initialListingFields, changeBuilderCategory } = load(
  'lib/listing-builder.ts'
)
const file = { type: 'image/jpeg', size: 100 }
const fields = {
  ...initialListingFields(),
  title: 'Camera',
  price: '0',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'On campus',
  description: 'Works well.',
}
assert.throws(() => validateBuilder(fields, []), /1-6/)
for (const count of [1, 6]) {
  const input = validateBuilder(fields, Array(count).fill(file))
  assert.equal(input.price, 0)
  assert.equal(input.expectedImageCount, count)
}
assert.throws(() => validateBuilder(fields, Array(7).fill(file)), /1-6/)
assert.throws(() => validateBuilder(fields, [{ ...file, type: 'image/gif' }]))
assert.throws(() => validateBuilder(fields, [{ ...file, size: 3145729 }]))
assert.equal(changeBuilderCategory(fields, 'Home & Dorm').subcategory, '')
assert.equal(
  changeBuilderCategory(fields, 'Electronics').subcategory,
  'Cameras'
)
for (const name of [
  'title',
  'price',
  'description',
  'condition',
  'pickupArea',
]) {
  const values = {
    title: 'New title',
    price: '12.99',
    description: 'Changed',
    condition: 'fair',
    pickupArea: 'Other',
  }
  assert.doesNotThrow(() =>
    validateBuilder({ ...fields, [name]: values[name] }, [], {
      photoUrls: ['url'],
      expectedImageCount: 1,
    })
  )
}
console.log(
  'PASS Listings builder: 0/1/6/7 photos, MIME/size, Free, taxonomy reset, all five editable fields.'
)
