// Local DTO/builder/terms contracts. No hosted traffic or provider content persistence.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
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
    (n) => (n.startsWith('@/') ? load(n.slice(2) + '.ts') : require(n)),
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const { parseMeetingLocation } = load('lib/meeting-location.ts'),
  { initialListingFields, validateBuilder } = load('lib/listing-builder.ts'),
  { mapListing } = load('lib/supabase/listing-mapper.ts'),
  { offerPayload } = load('lib/offers-api.ts'),
  { mapTerms } = load('lib/server/offers-service.ts'),
  { offerChangedFields } = load('lib/offer-changes.ts')
const location = {
  label: 'Outside Weldon front entrance',
  provider: 'google',
  placeId: 'fixture_1',
}
assert.deepEqual(parseMeetingLocation(location), location)
assert.deepEqual(parseMeetingLocation({ label: ' At UCC ' }), {
  label: 'At UCC',
})
for (const bad of [
  { label: 'UCC', placeId: 'fixture_1' },
  { label: 'UCC', provider: 'google' },
  { label: 'UCC', provider: 'other', placeId: 'fixture_1' },
  { label: 'UCC', displayName: 'Google content' },
  { label: ' '.repeat(3) },
  { label: 'a'.repeat(121) },
])
  assert.throws(() => parseMeetingLocation(bad))
const fields = {
  ...initialListingFields(),
  title: 'Synthetic',
  price: '80',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'Near campus',
  description: 'Synthetic',
  meetingLocation: location,
}
const input = validateBuilder(fields, [{ type: 'image/jpeg', size: 100 }])
assert.equal(input.pickupArea, 'Near campus')
assert.deepEqual(input.meetingLocation, location)
assert.throws(
  () =>
    validateBuilder({ ...fields, meetingLocation: null }, [
      { type: 'image/jpeg', size: 100 },
    ]),
  /Meeting location is required/
)
assert.equal(
  validateBuilder({ ...fields, preferredFulfillment: 'DELIVERY' }, [
    { type: 'image/jpeg', size: 100 },
  ]).preferredFulfillment,
  'DELIVERY'
)
const row = {
  id: 'listing',
  pickup_area: 'Other',
  preferred_fulfillment: 'ON_CAMPUS',
  meeting_location: location.label,
  meeting_location_provider: 'google',
  meeting_place_id: 'fixture_1',
  listing_images: [],
  profiles: { id: 'seller', display_name: 'Seller' },
}
assert.deepEqual(mapListing(row, () => '').meetingLocation, location)
assert.deepEqual(
  initialListingFields(mapListing(row, () => '')).meetingLocation,
  location
)
assert.equal(
  mapListing({ ...row, meeting_location: undefined }, () => '').meetingLocation,
  null
)
const terms = {
  fulfillment: 'on_campus',
  itemAmountCents: 8000,
  currency: 'CAD',
  note: '',
  scheduledAt: new Date(Date.now() + 86400000).toISOString(),
  meetupLocation: location.label,
  meetupLocationProvider: 'google',
  meetupPlaceId: 'fixture_1',
}
const payload = offerPayload(terms)
assert.deepEqual(
  mapTerms({ item_amount_cents: 8000, offer_terms: payload }),
  terms
)
const legacy = { ...terms }
delete legacy.meetupLocationProvider
delete legacy.meetupPlaceId
assert.deepEqual(
  mapTerms({ item_amount_cents: 8000, offer_terms: offerPayload(legacy) }),
  legacy
)
assert.deepEqual(
  offerChangedFields(
    { ...terms, meetupLocation: '  OUTSIDE  Weldon front entrance ' },
    terms
  ),
  []
)
assert.deepEqual(
  offerChangedFields(
    { ...terms, meetupLocation: 'Outside rear entrance' },
    terms
  ),
  ['Meeting location']
)
assert.deepEqual(
  offerChangedFields({ ...terms, meetupPlaceId: 'fixture_2' }, terms),
  []
)
const frozen = JSON.parse(JSON.stringify(payload))
row.meeting_location = 'New Listing default'
assert.equal(frozen.meetup_location, location.label)
assert(!JSON.stringify(payload).includes('displayName'))
assert(!JSON.stringify(payload).includes('formattedAddress'))
console.log(
  'PASS Meeting Listing create/edit/legacy/null/Delivery, independent Place taxonomy, minimal DTO, free-text/Google Offer payload/map round-trip, normalized Changed terms, no provider-content persistence; zero network.'
)
