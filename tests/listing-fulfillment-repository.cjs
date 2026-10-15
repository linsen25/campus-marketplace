// Real repository/validation/mapper with a synthetic in-memory Supabase adapter.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const id = '11111111-1111-4111-8111-111111111111'
let row = {
    id,
    seller_id: 'seller',
    title: 'Fixture',
    description: 'Description',
    price_cents: 8000,
    currency: 'CAD',
    category: 'Electronics',
    subcategory: 'Cameras',
    condition: 'good',
    pickup_area: 'Near campus',
    status: 'available',
    published_at: '2026-10-01',
    expected_image_count: 1,
    profiles: { id: 'seller', display_name: 'Seller' },
    listing_images: [],
  },
  writes = []
const client = {
  from(table) {
    assert.equal(table, 'listings')
    return {
      select() {
        return this
      },
      eq() {
        return this
      },
      filter() {
        return this
      },
      insert(input) {
        writes.push(input)
        row = { ...row, ...input, published_at: null }
        return this
      },
      update(input) {
        writes.push(input)
        row = { ...row, ...input }
        return this
      },
      async single() {
        return { data: { ...row }, error: null }
      },
      async maybeSingle() {
        return { data: { ...row }, error: null }
      },
    }
  },
  storage: {
    from() {
      return { getPublicUrl: () => ({ data: { publicUrl: 'fixture' } }) }
    },
  },
}
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
    (n) => {
      if (n === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (n === '@/lib/server/marketplace-auth')
        return { requireMarketplaceUser: async () => ({ id: 'seller' }) }
      if (n === '@/lib/listing-fulfillment')
        return { listingFulfillmentEnabled: () => true }
      return n.startsWith('@/') ? load(n.slice(2) + '.ts') : require(n)
    },
    m,
    m.exports
  )
  return m.exports
}
async function run() {
  const repo = load(
    'lib/server/supabase-listings-repository.ts'
  ).createSupabaseListingsRepository({})
  const legacy = await repo.getCreationListing(id)
  assert.equal(legacy.meetingLocation, null)
  assert.equal(legacy.estimatedDeliveryFeeCents, 0)
  await assert.rejects(
    repo.updateListing(id, { title: 'Missing Meeting' }),
    /Meeting location is required/
  )
  const updated = await repo.updateListing(id, {
    meetingLocation: { label: 'User entrance' },
    preferredFulfillment: 'DELIVERY',
    estimatedDeliveryFeeCents: 1050,
  })
  assert.equal(updated.estimatedDeliveryFeeCents, 1050)
  assert.equal(updated.meetingLocation.label, 'User entrance')
  assert.equal(row.pickup_area, 'Near campus')
  assert.equal(
    (await repo.getCreationListing(id)).estimatedDeliveryFeeCents,
    1050
  )
  const input = {
    title: 'New',
    description: 'Description',
    price: 8000,
    currency: 'CAD',
    category: 'Electronics',
    subcategory: 'Cameras',
    condition: 'good',
    meetingLocation: { label: 'Another entrance' },
    preferredFulfillment: 'DELIVERY',
    photoUrls: [],
    expectedImageCount: 1,
  }
  const created = await repo.createListing(input)
  assert.equal(created.estimatedDeliveryFeeCents, 0)
  assert.equal(row.pickup_area, null)
  assert.equal(created.pickupArea, undefined)
  assert.equal(row.meeting_location, 'Another entrance')
  row.published_at = '2026-10-01'
  await repo.updateListing(id, { estimatedDeliveryFeeCents: 1050 })
  assert.equal(row.estimated_delivery_fee_cents, 1050)
  assert.equal((await repo.getListing(id)).estimatedDeliveryFeeCents, 1050)
  for (const fee of [-1, 0.1, Number.MAX_SAFE_INTEGER + 1])
    await assert.rejects(
      repo.updateListing(id, { estimatedDeliveryFeeCents: fee }),
      /integer cents/
    )
  assert(
    writes.every(
      (w) => w.pickup_area === null || w.pickup_area === 'Near campus'
    )
  )
  console.log(
    'PASS real Listing repository Create/Edit/read mapping: cents persistence, default 0, required Meeting, preserved historical pickup, new NULL pickup, invalid fees rejected; zero network'
  )
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
