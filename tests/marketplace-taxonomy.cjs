const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
const calls = []
const id = '11111111-1111-4111-8111-111111111111'
let row = {
  id,
  seller_id: 'owner',
  title: 'Desk',
  description: '',
  price_cents: 0,
  currency: 'CAD',
  category: 'Home & Dorm',
  subcategory: 'Furniture',
  condition: null,
  pickup_area: 'Campus',
  status: 'available',
  created_at: '2026-10-04',
  updated_at: '2026-10-04',
  published_at: '2026-10-04',
  expected_image_count: 1,
  profiles: { id: 'owner', display_name: 'Owner' },
  listing_images: [],
}
const client = {
  storage: {
    from: () => ({ getPublicUrl: (p) => ({ data: { publicUrl: p } }) }),
  },
  from: (table) => {
    assert.equal(table, 'listings')
    const chain = {
      returns() {
        return chain
      },
      select() {
        return chain
      },
      insert(input) {
        calls.push(['insert', input])
        row = { ...row, ...input }
        return chain
      },
      update(input) {
        calls.push(['update', input])
        row = { ...row, ...input }
        return chain
      },
      eq(key, value) {
        calls.push(['eq', key, value])
        return chain
      },
      filter(key, op, value) {
        calls.push(['not', key, op, value])
        return chain
      },
      order() {
        return chain
      },
      range: async () => ({ data: [row], error: null }),
      single: async () => ({ data: row, error: null }),
      maybeSingle: async () => ({ data: row, error: null }),
    }
    return chain
  },
}
const mocks = {
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
  '@/lib/server/marketplace-auth': {
    requireMarketplaceUser: async () => ({ id: 'owner' }),
    requireSameOriginWrite: () => {},
  },
}
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      mocks[name] ||
      (name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)),
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
const { marketTaxonomy, isMarketPair } = load('lib/market-taxonomy.ts')
const { validateListingInput, validateListingPatch } = load(
  'lib/listing-validation.ts'
)
const { parseListingFilters } = load('lib/listing-filters.ts')
const base = {
  title: 'Item',
  description: '',
  price: 0,
  currency: 'CAD',
  pickupArea: 'Campus',
  photoUrls: [],
  expectedImageCount: 1,
}
const parents = [
  'Electronics',
  'Home & Dorm',
  'Textbooks & School',
  'Clothing & Accessories',
  'Sports & Outdoors',
  'Bikes & Mobility',
  'Games & Hobbies',
  'Other',
]
assert.deepEqual(Object.keys(marketTaxonomy), parents)
assert.equal(Object.values(marketTaxonomy).flat().length, 45)
for (const [category, children] of Object.entries(marketTaxonomy)) {
  for (const subcategory of children) {
    assert(isMarketPair(category, subcategory))
    const input = validateListingInput({ ...base, category, subcategory })
    assert.equal(input.subcategory, subcategory)
  }
  assert.throws(
    () => validateListingInput({ ...base, category }),
    /Choose a marketplace subcategory/
  )
}
assert.throws(
  () =>
    validateListingInput({
      ...base,
      category: 'Electronics',
      subcategory: 'Furniture',
    }),
  /does not belong/
)
for (const category of [
  'furniture',
  'electronics',
  'books',
  'clothing',
  'home-kitchen',
  'free',
  'sports-hobbies',
  'other',
]) {
  assert.throws(
    () => validateListingInput({ ...base, category, subcategory: 'Other' }),
    /Choose a marketplace category/
  )
  assert(parseListingFilters({ category }).error)
}
for (const key of ['title', 'price', 'description', 'condition', 'pickupArea'])
  assert.doesNotThrow(() => validateListingPatch({ [key]: key }))
for (const key of [
  'category',
  'subcategory',
  'photoUrls',
  'images',
  'currency',
  'status',
])
  assert.throws(() => validateListingPatch({ [key]: 'Other' }), /Only title/)
for (const status of ['available', 'sold'])
  assert.equal(parseListingFilters({ status }).query.status, status)
assert(parseListingFilters({ status: 'active' }).error)
assert.equal(
  parseListingFilters({ category: 'Electronics' }).query.category,
  'Electronics'
)
assert.equal(
  parseListingFilters({ category: 'Electronics', subcategory: 'Cameras' }).query
    .subcategory,
  'Cameras'
)
assert(
  parseListingFilters({ category: 'Electronics', subcategory: 'Furniture' })
    .error
)
assert(parseListingFilters({ subcategory: 'Cameras' }).error)
for (const listing of load('lib/fixtures/listings.ts').listingFixtures)
  assert(isMarketPair(listing.category, listing.subcategory))
;(async () => {
  const repository = load(
    'lib/server/supabase-listings-repository.ts'
  ).createSupabaseListingsRepository({})
  for (const category of parents) {
    const subcategory = marketTaxonomy[category][0]
    const listing = await repository.createListing({
      ...base,
      category,
      subcategory,
    })
    assert.equal(listing.category, category)
    assert.equal(listing.subcategory, subcategory)
    assert.equal(calls.at(-1)[1].subcategory, subcategory)
  }
  for (const key of ['category', 'subcategory', 'photoUrls', 'images']) {
    const before = calls.filter((c) => c[0] === 'update').length
    await assert.rejects(
      repository.updateListing(id, { [key]: 'Other' }),
      /Only title/
    )
    assert.equal(calls.filter((c) => c[0] === 'update').length, before)
  }
  const saved = await repository.updateListing(id, {
    title: 'Changed',
    price: 1200,
    description: 'Description',
    condition: 'good',
    pickupArea: 'Near campus',
  })
  assert.equal(saved.title, 'Changed')
  const update = calls.filter((c) => c[0] === 'update').at(-1)[1]
  assert.deepEqual(Object.keys(update).sort(), [
    'condition',
    'description',
    'pickup_area',
    'price_cents',
    'title',
  ])
  calls.length = 0
  await repository.getListings({ category: 'Electronics' })
  assert(calls.some((c) => c[1] === 'category' && c[2] === 'Electronics'))
  assert(!calls.some((c) => c[1] === 'subcategory'))
  calls.length = 0
  await repository.getListings({
    category: 'Electronics',
    subcategory: 'Cameras',
    status: 'available',
  })
  assert(calls.some((c) => c[1] === 'subcategory' && c[2] === 'Cameras'))
  await assert.rejects(
    repository.getListings({
      category: 'Electronics',
      subcategory: 'Furniture',
    }),
    /valid category\/subcategory/
  )
  await assert.rejects(
    repository.getListings({ status: 'active' }),
    /Invalid status/
  )
  // Exercise the actual API query parser and update handler, with only external boundaries mocked.
  mocks['@/lib/listings-api'] = {
    getListings: (q) => repository.getListings(q),
    createListing: (input) => repository.createListing(input),
    updateListing: (key, input) => repository.updateListing(key, input),
  }
  const handler = load('pages/api/listings/[[...segments]].ts').default
  const response = () => ({
    setHeader() {},
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  })
  let res = response()
  await handler(
    {
      method: 'GET',
      query: { category: 'Electronics', subcategory: 'Cameras' },
    },
    res
  )
  assert.equal(res.code, 200)
  res = response()
  await handler(
    {
      method: 'POST',
      query: {},
      body: { ...base, category: 'Electronics', subcategory: 'Cameras' },
    },
    res
  )
  assert.equal(res.code, 201)
  assert.equal(res.body.subcategory, 'Cameras')
  res = response()
  await handler(
    { method: 'PATCH', query: { segments: [id] }, body: { category: 'Other' } },
    res
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /locked/)
  console.log(
    'PASS canonical taxonomy: 8 parents/45 pairs, create/missing/mismatched/legacy rejection, immutable edits/images, fixtures, mapper, repository and real API query/update contracts; available/sold unchanged'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
