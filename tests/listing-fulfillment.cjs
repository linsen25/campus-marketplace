// Listing defaults/validation and DTOs; no hosted mutations.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
function load(file) {
  const m = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: 1, target: 7 },
    }).outputText
  )(
    (n) => (n.startsWith('@/') ? load(n.slice(2) + '.ts') : require(n)),
    m,
    m.exports
  )
  return m.exports
}
const { initialListingFields, validateBuilder } = load(
    'lib/listing-builder.ts'
  ),
  { validateListingInput } = load('lib/listing-validation.ts'),
  { mapListing } = load('lib/supabase/listing-mapper.ts')
const fields = {
  ...initialListingFields(),
  title: 'Synthetic',
  price: '80',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  description: 'Synthetic',
  meetingLocation: { label: 'Front entrance' },
}
const file = { type: 'image/jpeg', size: 100 },
  validate = (f) => validateBuilder(f, [file])
for (const preferredFulfillment of ['ON_CAMPUS', 'DELIVERY']) {
  assert.throws(
    () => validate({ ...fields, preferredFulfillment, meetingLocation: null }),
    /Meeting location is required/
  )
  for (const [text, cents] of [
    ['', 0],
    ['0', 0],
    ['0.00', 0],
    ['10.50', 1050],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ]) {
    const input = validate({
      ...fields,
      preferredFulfillment,
      estimatedDeliveryFee: text,
    })
    assert.equal(input.estimatedDeliveryFeeCents, cents)
    assert.equal(input.pickupArea, undefined)
    assert.equal(input.meetingLocation.label, 'Front entrance')
  }
}
for (const text of ['-1', '1.234', 'Infinity', '1e3', '90071992547409.92'])
  assert.throws(
    () =>
      validate({
        ...fields,
        preferredFulfillment: 'DELIVERY',
        estimatedDeliveryFee: text,
      }),
    /estimated delivery fee/
  )
const input = validate(fields)
for (const fee of [-1, 0.1, '1050', Number.MAX_SAFE_INTEGER + 1])
  assert.throws(
    () => validateListingInput({ ...input, estimatedDeliveryFeeCents: fee }),
    /integer cents/
  )
const row = {
  id: 'legacy',
  pickup_area: 'Near campus',
  listing_images: [],
  profiles: { id: 'seller', display_name: 'Seller' },
}
const legacy = mapListing(row, () => ''),
  initial = initialListingFields(legacy)
assert.equal(initial.meetingLocation, null)
assert.equal(initial.estimatedDeliveryFee, '0.00')
assert.equal(initial.pickupArea, undefined)
assert.equal(
  validateBuilder({ ...fields }, [], {
    ...legacy,
    photoUrls: [],
    expectedImageCount: 1,
  }).pickupArea,
  'Near campus'
)
assert.equal(
  mapListing(
    { ...row, pickup_area: null, estimated_delivery_fee_cents: 1050 },
    () => ''
  ).estimatedDeliveryFeeCents,
  1050
)
assert.equal(
  mapListing({ ...row, pickup_area: null }, () => '').pickupArea,
  undefined
)
assert.equal(
  initialListingFields({ ...legacy, estimatedDeliveryFeeCents: 1050 })
    .estimatedDeliveryFee,
  '10.50'
)
console.log(
  'PASS Listing required Meeting for both modes, optional estimate blank/zero/custom/safe maximum, invalid money, legacy read/edit, nullable legacy place, integer DTO round trip; no network'
)
