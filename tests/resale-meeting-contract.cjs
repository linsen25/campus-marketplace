// Local contract checks only: no provider, database, or hosted project access.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const mod = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
  )(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    mod,
    mod.exports
  )
  cache.set(full, mod.exports)
  return mod.exports
}
const { validateListingInput } = load('lib/listing-validation.ts')
const base = {
  title: 'Meeting fixture',
  description: 'A safe test fixture.',
  price: 1200,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  expectedImageCount: 1,
  photoUrls: [],
  preferredPaymentMode: 'uu_pay',
  preferredFulfillment: 'ON_CAMPUS',
  meetingArea: 'OTHER',
  meetingLocation: {
    label: 'Fixture Place',
    provider: 'google',
    placeId: 'fixture_1',
  },
  meetingLocationDetail: 'North entrance',
  estimatedDeliveryFeeCents: 0,
}
const meeting = validateListingInput(base)
assert.equal(meeting.meetingArea, 'OTHER')
assert.equal(meeting.meetingLocationDetail, 'North entrance')
assert.deepEqual(meeting.meetingLocation, base.meetingLocation)
assert.throws(
  () =>
    validateListingInput({ ...base, meetingLocation: { label: 'Typed only' } }),
  /suggested Google Place/
)
assert.equal(
  validateListingInput({
    ...base,
    preferredFulfillment: 'DELIVERY',
    meetingArea: 'OTHER',
    meetingLocation: base.meetingLocation,
    meetingLocationDetail: 'Retained locally but not submitted',
  }).meetingLocation,
  null
)
const migration = fs.readFileSync(
  'supabase/migrations/20261114224032_resale_meeting_area_location_detail.sql',
  'utf8'
)
for (const expected of [
  'meeting_area',
  'meeting_location_detail',
  'listings_resale_meeting_contract',
  "new.meeting_location_provider <> 'google'",
  "new.preferred_fulfillment = 'DELIVERY'",
])
  assert.match(
    migration,
    new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  )
console.log(
  'PASS resale Meeting/Delivery, Google-selection, detail, and local migration contract; zero network.'
)
