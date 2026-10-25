const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const cache = new Map()
const calls = []
const ids = [
  '29111111-1111-4111-8111-111111111111',
  '29222222-2222-4222-8222-222222222222',
]
const row = (id, title) => ({
  id,
  seller_id: '29999999-9999-4999-8999-999999999999',
  listing_channel: 'resale',
  title,
  description: 'Description',
  price_cents: 1200,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Monitors',
  condition: 'good',
  pickup_area: 'Campus',
  status: 'available',
  created_at: '2026-10-23T00:00:00.000Z',
  updated_at: '2026-10-23T00:00:00.000Z',
  published_at: '2026-10-23T00:00:00.000Z',
  expected_image_count: 0,
  profiles: {
    id: '29999999-9999-4999-8999-999999999999',
    display_name: 'Seller',
  },
  listing_images: [],
})
let rpcResult = { data: { ids, total: 250 }, error: null }
let listingRows = [row(ids[1], 'Second'), row(ids[0], 'First')]
const client = {
  storage: {
    from: () => ({ getPublicUrl: (value) => ({ data: { publicUrl: value } }) }),
  },
  rpc: async (name, input) => {
    calls.push(['rpc', name, input])
    return rpcResult
  },
  from: (table) => {
    assert.equal(table, 'listings')
    const chain = {
      select() {
        return chain
      },
      in(column, values) {
        calls.push(['in', column, values])
        return Promise.resolve({
          data: listingRows,
          error: null,
        })
      },
    }
    return chain
  },
}
const mocks = {
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
  '@/lib/server/marketplace-auth': {
    requireMarketplaceUser: async () => ({ id: 'user' }),
  },
  '@/lib/server/public-shop': {
    getPublicShopListing: async () => ({ state: 'not_found' }),
    getPublicShopProducts: async () => ({ listings: [] }),
  },
  '@/lib/server/listing-image-storage': {
    removeListingImageObjects: async () => null,
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
      esModuleInterop: true,
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

void (async () => {
  const repository = load(
    'lib/server/supabase-listings-repository.ts'
  ).createSupabaseListingsRepository({})
  const page = await repository.getResaleListingsPage({
    channel: 'resale',
    status: 'available',
    search: '  MONITOR  ',
    category: 'Electronics',
    subcategory: 'Monitors',
    condition: 'good',
    pickupArea: 'Campus',
    minPrice: 100,
    maxPrice: 5000,
    sort: 'price-low',
    page: 3,
    pageSize: 15,
  })
  assert.equal(page.total, 250)
  assert.equal(page.page, 3)
  assert.deepEqual(
    page.listings.map((listing) => listing.id),
    ids,
    'Database-ranked IDs must control response order.'
  )
  const rpc = calls.find((call) => call[0] === 'rpc')
  assert.equal(rpc[1], 'marketplace_browse_resale')
  assert.deepEqual(rpc[2], {
    p_search: '  MONITOR  ',
    p_category: 'Electronics',
    p_subcategory: 'Monitors',
    p_condition: 'good',
    p_pickup_area: 'Campus',
    p_min_price: 100,
    p_max_price: 5000,
    p_sort: 'price-low',
    p_offset: 30,
    p_limit: 15,
  })
  await assert.rejects(
    repository.getResaleListingsPage({ channel: 'shop' }),
    /only supports available Resale/
  )
  await assert.rejects(
    repository.getResaleListingsPage({ pageSize: 101 }),
    /page size between 1 and 100/
  )
  listingRows = [row(ids[0], 'First')]
  await assert.rejects(
    repository.getResaleListingsPage({ channel: 'resale' }),
    /changed while this page was loading/,
    'A concurrent deletion must trigger a retry instead of returning a silently incomplete page.'
  )
  listingRows = [row(ids[1], 'Second'), row(ids[0], 'First')]
  rpcResult = {
    data: null,
    error: { code: 'XX000', message: 'controlled database failure' },
  }
  await assert.rejects(
    repository.getResaleListingsPage({ channel: 'resale' }),
    /database is unavailable/,
    'Database errors must not become empty results.'
  )

  const route = fs.readFileSync('pages/api/listings/[[...segments]].ts', 'utf8')
  assert.match(route, /X-Total-Count/)
  assert.match(route, /req\.query\.paged === 'true'/)
  assert.doesNotMatch(
    fs.readFileSync('components/listings/market-layout.tsx', 'utf8'),
    /do \{[\s\S]*pageSize: 100[\s\S]*while/,
    'Market must not page through the entire Resale catalog in browser memory.'
  )
  console.log(
    'PASS B29 API: bounded query envelope, stable server order, filters, page metadata, invalid input, database error propagation, array response compatibility.'
  )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
