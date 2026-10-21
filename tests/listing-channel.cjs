// Current API/repository/query paths, with an in-memory Supabase boundary only.
const fs = require('node:fs'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
const seller = '11111111-1111-4111-8111-111111111111'
const seed = (id, channel) => ({
  id,
  seller_id: seller,
  listing_channel: channel,
  title: 'Fixture',
  description: 'Description',
  price_cents: 1000,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickup_area: null,
  preferred_fulfillment: 'ON_CAMPUS',
  preferred_payment_mode: 'uu_pay',
  meeting_location: 'Library entrance',
  estimated_delivery_fee_cents: 0,
  status: 'available',
  created_at: '2026-10-16',
  updated_at: '2026-10-16',
  published_at: '2026-10-16',
  expected_image_count: 1,
  profiles: { id: seller, display_name: 'Fixture' },
  listing_images: [],
})
let rows = [
  seed('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'resale'),
  seed('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'shop'),
]
let last = [],
  writes = [],
  authenticated = true
const client = {
  from(table) {
    assert.equal(table, 'listings')
    const operations = []
    let value
    let insert = false
    const run = () => {
      last = operations
      let data = rows.filter((row) =>
        operations.every(([op, key, val]) =>
          op === 'eq'
            ? row[key] === val
            : op === 'filter'
            ? row[key] !== null
            : true
        )
      )
      if (insert) {
        const row = {
          ...seed('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'resale'),
          ...value,
          published_at: null,
        }
        rows.push(row)
        data = [row]
      } else if (value) {
        data.forEach((row) => Object.assign(row, value))
      }
      return { data, error: null }
    }
    return {
      select() {
        return this
      },
      eq(key, val) {
        operations.push(['eq', key, val])
        return this
      },
      filter(key, op, val) {
        operations.push(['filter', key, val])
        return this
      },
      order() {
        return this
      },
      range() {
        return this
      },
      gte() {
        return this
      },
      lte() {
        return this
      },
      ilike() {
        return this
      },
      insert(input) {
        writes.push(input)
        value = input
        insert = true
        return this
      },
      update(input) {
        writes.push(input)
        value = input
        return this
      },
      async single() {
        const r = run()
        return { ...r, data: r.data[0] }
      },
      async maybeSingle() {
        const r = run()
        return { ...r, data: r.data[0] || null }
      },
      then(ok, no) {
        return Promise.resolve(run()).then(ok, no)
      },
    }
  },
  storage: {
    from() {
      return { getPublicUrl: () => ({ data: { publicUrl: 'fixture' } }) }
    },
  },
}
const cache = {}
function load(file) {
  if (cache[file]) return cache[file].exports
  const m = { exports: {} }
  cache[file] = m
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: 1, target: 7, jsx: 4, esModuleInterop: true },
    }).outputText
  )(
    (name) => {
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (name === '@/lib/server/marketplace-auth')
        return {
          requireMarketplaceUser: async () => {
            if (!authenticated)
              throw new (load('lib/listing-validation.ts').ListingApiError)(
                'Sign in',
                401
              )
            return { id: seller }
          },
          requireSameOriginWrite: () => {},
        }
      if (name === '@/lib/listing-fulfillment')
        return { listingFulfillmentEnabled: () => true }
      if (name === 'next/head') return () => null
      if (name === 'react/jsx-runtime') return require(name)
      if (name === '@/components/listings/market-layout')
        return { MarketLayout: () => null }
      if (name === '@/lib/server/public-shop')
        return {
          getPublicShops: async () => ({ shops: [] }),
          getPublicShopProducts: async () => ({
            listings: rows
              .filter(
                (row) => row.listing_channel === 'shop' && row.published_at
              )
              .map((row) =>
                load('lib/supabase/listing-mapper.ts').mapListing(
                  row,
                  (path) => 'https://legacy/' + path
                )
              ),
          }),
          getPublicShopListing: async () => ({ state: 'not_found' }),
        }
      return name.startsWith('@/')
        ? load(
            name.slice(2) + '.ts' + (name.includes('listing-form') ? 'x' : '')
          )
        : require(name)
    },
    m,
    m.exports
  )
  return m.exports
}
const api = load('lib/listings-api.ts'),
  repo = load(
    'lib/server/supabase-listings-repository.ts'
  ).createSupabaseListingsRepository({})
const handler = load('pages/api/listings/[[...segments]].ts').default
async function request(query = {}, method = 'GET', body) {
  const res = {
    setHeader() {},
    status(n) {
      this.code = n
      return this
    },
    json(v) {
      this.body = v
      return this
    },
  }
  await handler({ method, query, body }, res)
  return res
}
async function main() {
  assert.deepEqual(
    (await repo.getListings()).map((r) => r.listingChannel),
    ['resale']
  )
  assert(
    last.some((op) => op[1] === 'listing_channel' && op[2] === 'resale'),
    'unscoped public reads cannot inherit private owner Shop visibility; Shop reads use the public projection'
  )
  for (const channel of ['resale', 'shop']) {
    assert.deepEqual(
      (await repo.getListings({ channel })).map((r) => r.listingChannel),
      [channel]
    )
    assert.deepEqual(
      (await repo.getMyListings({ channel })).map((r) => r.listingChannel),
      [channel]
    )
    const r = await request({ mine: 'true', channel })
    assert.equal(r.code, 200)
    assert.deepEqual(
      r.body.map((r) => r.listingChannel),
      [channel]
    )
  }
  assert.equal(
    (await api.getMyListings({ req: {}, res: {} })).length,
    2,
    'legacy SSR context signature stays unscoped'
  )
  assert.equal((await api.getMyListings({}, { req: {}, res: {} })).length, 2)
  for (const channel of ['', 'both', 'SHOP', null, []]) {
    await assert.rejects(repo.getListings({ channel }), /channel/)
    await assert.rejects(repo.getMyListings({ channel }), /channel/)
    assert.equal((await request({ mine: 'true', channel })).code, 400)
  }
  assert.equal(
    (await request({ mine: 'true', channel: ['resale', 'shop'] })).code,
    400
  )
  await repo.getFavoriteListings()
  assert(
    !last.some((op) => op[1] === 'listing_channel'),
    'shared Favorites query has no channel filter'
  )
  const input = {
    title: 'New',
    description: 'Description',
    price: 1000,
    currency: 'CAD',
    category: 'Electronics',
    subcategory: 'Cameras',
    condition: 'good',
    meetingLocation: { label: 'Library entrance' },
    photoUrls: [],
    expectedImageCount: 1,
  }
  for (const key of ['listingChannel', 'listing_channel']) {
    assert.equal(
      (await request({}, 'POST', { ...input, [key]: 'shop' })).code,
      400
    )
    assert.equal(
      (await request({ segments: [rows[0].id] }, 'PATCH', { [key]: 'shop' }))
        .code,
      400
    )
  }
  const created = await repo.createListing(input)
  assert.equal(created.listingChannel, 'resale')
  assert(!('listing_channel' in writes.at(-1)), 'creation relies on DB default')
  await repo.updateListing(rows[0].id, { title: 'Edited' })
  assert.equal(rows[0].listing_channel, 'resale')
  assert(!('listing_channel' in writes.at(-1)))
  authenticated = false
  assert.equal((await request({ mine: 'true', channel: 'shop' })).code, 401)
  authenticated = true
  const ssr = load('pages/listings/index.tsx')
  await ssr.getServerSideProps({
    query: { channel: 'shop', status: 'sold' },
    req: {},
    res: { setHeader() {} },
  })
  assert(
    last.some((op) => op[1] === 'listing_channel' && op[2] === 'resale'),
    'Marketplace SSR fixed resale'
  )
  assert(last.some((op) => op[1] === 'status' && op[2] === 'available'))
  assert.match(
    fs.readFileSync('components/listings/market-layout.tsx', 'utf8'),
    /getListings\(\{[^}]*channel:\s*'resale'/s
  )
  assert.match(
    fs.readFileSync('components/listings/home-listings.tsx', 'utf8'),
    /getMyListings\(\{\s*channel\s*\}/
  )
  const previousFetch = global.fetch
  global.window = {}
  let url
  global.fetch = async (path) => {
    url = path
    return { ok: true, json: async () => [] }
  }
  try {
    await api.getMyListings({ channel: 'shop' })
    assert.equal(url, '/api/listings?mine=true&channel=shop')
    await api.getMyListings()
    assert.equal(url, '/api/listings?mine=true')
  } finally {
    delete global.window
    global.fetch = previousFetch
  }
  console.log(
    'PASS channel DTO mapping, generic/unscoped/shared Favorites queries, scoped owner/public queries, legacy SSR signature, API invalid/duplicate channels, forged POST/PATCH rejection, default Resale create/edit, SSR/client/Home explicit scope, browser serialization'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
