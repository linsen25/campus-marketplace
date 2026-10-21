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
          requireSameOriginWrite: load('lib/server/marketplace-auth.ts')
            .requireSameOriginWrite,
        }
      if (name === '@/lib/listing-fulfillment')
        return { listingFulfillmentEnabled: () => true }
      if (name === 'next/head') return () => null
      if (name === 'react/jsx-runtime') return require(name)
      if (name === '@/components/listings/market-layout')
        return { MarketLayout: () => null }
      if (name === '@/lib/server/public-shop')
        return { getPublicShops: () => [] }
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
async function request(query = {}, method = 'GET', body, headers = {}) {
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
  await handler(
    {
      method,
      query,
      body,
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
        ...headers,
      },
    },
    res
  )
  return res
}

let fault = null
const calls = []
client.rpc = async (name, params) => {
  calls.push({ name, params })
  if (fault) return { data: null, error: fault }
  assert.equal(name, 'marketplace_create_shop_listing')
  const id = params.p_client_action_id
  let row = rows.find((r) => r.id === id)
  if (!row) {
    row = { ...seed(id, 'shop'), ...params.p_input, published_at: null }
    rows.push(row)
  }
  return { data: id, error: null }
}
async function main() {
  const input = {
    title: 'Shop camera',
    description: 'Photo equipment',
    price: 1200,
    currency: 'CAD',
    category: 'Electronics',
    subcategory: 'Cameras',
    condition: 'good',
    expectedImageCount: 1,
    photoUrls: [],
    preferredFulfillment: 'ON_CAMPUS',
    preferredPaymentMode: 'external',
    meetingLocation: { label: 'Campus', provider: null, placeId: null },
    estimatedDeliveryFeeCents: 0,
  }
  const actionId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  assert.equal(
    (
      await request(
        { segments: ['shop'] },
        'POST',
        { input, actionId },
        { origin: 'https://other.example' }
      )
    ).code,
    403
  )
  assert.equal(
    (
      await request(
        { segments: ['shop'] },
        'POST',
        { input, actionId },
        { 'x-marketplace-request': undefined }
      )
    ).code,
    403
  )
  assert.equal(
    calls.length,
    0,
    'cross-origin/missing-header requests never reach RPC'
  )
  for (const key of [
    'seller',
    'sellerId',
    'seller_id',
    'shop_id',
    'owner_id',
    'tier',
    'quota',
    'listingChannel',
    'listing_channel',
    'status',
    'publishedAt',
  ])
    assert.equal(
      (
        await request({ segments: ['shop'] }, 'POST', {
          input: { ...input, [key]: 'forged' },
          actionId,
        })
      ).code,
      400
    )
  for (let i = 0; i < 2; i++) {
    const response = await request({ segments: ['shop'] }, 'POST', {
      input,
      actionId,
    })
    assert.equal(response.code, 201, JSON.stringify(response.body))
    assert.equal(response.body.id, actionId)
    assert.equal(response.body.listingChannel, 'shop')
  }
  assert.equal(rows.filter((r) => r.id === actionId).length, 1)
  assert.equal(calls[0].params.p_input.meeting_location, 'Campus')
  assert(!('seller_id' in calls[0].params.p_input))
  assert(!('listing_channel' in calls[0].params.p_input))
  for (const body of [
    { input },
    { input, actionId: 'bad' },
    { input, actionId, owner: 'forged' },
    { input: { ...input, listingChannel: 'resale' }, actionId },
    null,
  ])
    assert.equal(
      (await request({ segments: ['shop'] }, 'POST', body)).code,
      400
    )
  authenticated = false
  assert.equal(
    (await request({ segments: ['shop'] }, 'POST', { input, actionId })).code,
    401
  )
  authenticated = true
  for (const [message, code, status] of [
    ['Shop active product limit reached.', '23514', 409],
    ['Shop publishing requires an operating membership.', '42501', 403],
    ['PRIVATE_SECRET', 'XX000', 503],
  ]) {
    fault = { message, code }
    const r = await request({ segments: ['shop'] }, 'POST', { input, actionId })
    assert.equal(r.code, status)
    assert(!JSON.stringify(r.body).includes('PRIVATE_SECRET'))
  }
  assert.equal(
    (await request({ segments: ['shop'] }, 'PATCH', { input, actionId })).code,
    405
  )
  console.log(
    'PASS B14 actual API/repository: explicit Shop create, strict envelope/channel/UUID, owner auth, canonical metadata, repeated identity, safe quota/membership errors, no client seller/Shop/tier authority'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
