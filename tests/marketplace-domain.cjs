const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
const { isWesternEmail, safeMarketplaceNext } = load('lib/marketplace-auth.ts')
for (const value of ['student@uwo.ca', 'STUDENT@UWO.CA', ' student@uwo.ca '])
  assert(isWesternEmail(value))
for (const value of [
  'a@uwo.ca.evil.test',
  'a@sub.uwo.ca',
  'a@@uwo.ca',
  'a b@uwo.ca',
  '@uwo.ca',
  null,
])
  assert(!isWesternEmail(value))
assert.equal(safeMarketplaceNext('/listings/new'), '/listings/new')
for (const value of [
  '//evil.test',
  'https://evil.test',
  '/listings/../../evil',
  '/listings\\evil',
  '/api/listings',
])
  assert.equal(safeMarketplaceNext(value), '/home')
const { parseListingPrice } = load('utils/parse-listing-price.ts')
const { formatListingPrice } = load('utils/format-listing-price.ts')
for (const [input, cents, formatted] of [
  ['30', 3000, 'CA$30'],
  ['12.50', 1250, 'CA$12.50'],
  ['0', 0, 'FREE'],
  ['0.29', 29, 'CA$0.29'],
]) {
  assert.equal(parseListingPrice(input), cents)
  assert.equal(formatListingPrice(cents), formatted)
}
for (const input of ['', '-1', '1.001', '1e2', 'Infinity'])
  assert.throws(() => parseListingPrice(input))
const { validateListingImage, hasImageSignature } = load(
  'lib/listing-images.ts'
)
for (const type of ['image/jpeg', 'image/png', 'image/webp'])
  validateListingImage({ type, size: 1024 })
for (const file of [
  { type: 'image/svg+xml', size: 100 },
  { type: 'text/html', size: 100 },
  { type: 'image/png', size: 3145729 },
  { type: 'image/png', size: 0 },
])
  assert.throws(() => validateListingImage(file))
assert(hasImageSignature(Uint8Array.from([255, 216, 255, 0]), 'image/jpeg'))
assert(
  hasImageSignature(
    Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]),
    'image/png'
  )
)
assert(hasImageSignature(Buffer.from('RIFF0000WEBP'), 'image/webp'))
assert(!hasImageSignature(Buffer.from('<svg>malicious</svg>'), 'image/png'))
const { mapListing } = load('lib/supabase/listing-mapper.ts')
const listing = mapListing(
  {
    id: '1',
    title: 'Desk',
    description: 'Used',
    price_cents: 1250,
    currency: 'CAD',
    category: 'furniture',
    condition: null,
    pickup_area: 'Campus',
    status: 'available',
    created_at: '2026-09-29',
    updated_at: '2026-09-29',
    profiles: { id: 'owner', display_name: 'Alex' },
    listing_images: [
      { path: 'pending', slot: 1, ready: false },
      { path: 'second', slot: 3, ready: true },
      { path: 'first', slot: 2, ready: true },
    ],
  },
  (p) => 'https://images.test/' + p
)
assert.deepEqual(listing.photoUrls, [
  'https://images.test/first',
  'https://images.test/second',
])
assert.deepEqual(listing.seller, { id: 'owner', displayName: 'Alex' })
assert(!('email' in listing.seller))
assert(!('price_cents' in listing))
assert(!('condition' in listing))
console.log(
  'PASS: Western email matching, safe return paths, cents/price display, file limits/signatures, database-to-domain mapping and image publication order.'
)

const { parseListingFilters, listingFiltersUrl } = load(
  'lib/listing-filters.ts'
)
for (const category of ['Electronics', 'electronics', 'ELECTRONICS']) {
  const parsed = parseListingFilters({ category })
  assert.equal(parsed.error, null)
  assert.equal(parsed.query.category, 'electronics')
}
const filtered = parseListingFilters({
  category: 'Home & Kitchen',
  condition: 'good',
  minPrice: '12.50',
  maxPrice: '30',
  status: 'sold',
  search: 'desk',
  sort: 'price-high',
})
assert.equal(filtered.error, null)
assert.equal(filtered.query.minPrice, 1250)
assert.equal(filtered.query.maxPrice, 3000)
assert.equal(filtered.query.status, 'sold')
const roundtrip = parseListingFilters(
  Object.fromEntries(
    new URL('http://local' + listingFiltersUrl(filtered.values)).searchParams
  )
)
assert.deepEqual(roundtrip.query, filtered.query)
assert.equal(parseListingFilters({ status: 'all' }).query.status, undefined)
assert.equal(parseListingFilters({}).query.status, 'available')
assert(parseListingFilters({ status: 'hidden' }).error)
assert(parseListingFilters({ minPrice: '30', maxPrice: '12' }).error)
assert.equal(listingFiltersUrl(parseListingFilters({}).values), '/listings')
console.log(
  'PASS: category aliases, status, price conversion, query roundtrip, defaults and invalid filters.'
)

for (const route of [
  '/home',
  '/listings',
  '/listings/new',
  '/listings/example-id/edit',
  '/profile/listings',
])
  assert.equal(safeMarketplaceNext(route), route)
for (const route of [
  '/account',
  '/account/favorites',
  '/account/messages',
  '/account/profile',
  '/account/settings',
  '/account/unknown',
  '/account/../api/auth',
  '//account',
  '/account?next=https://evil.test',
  '/home/unknown',
  '/home?next=https://evil.test',
])
  assert.equal(safeMarketplaceNext(route), '/home')
console.log(
  'PASS: Home and listing return paths allowed; retired personal, unknown and unsafe paths fall back to Home.'
)
