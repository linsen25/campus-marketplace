// Real server projection and HTTP handler with a controlled Supabase transport.
const fs = require('fs'),
  path = require('path'),
  ts = require('typescript'),
  assert = require('assert/strict')
const id = '11111111-1111-4111-8111-111111111111',
  image = '22222222-2222-4222-8222-222222222222'
const shop = {
  id,
  sellerProfileId: id,
  username: 'real_seller',
  shopName: 'Real Shop',
  category: 'Electronics',
  description: 'Actual profile',
  badgeTier: 'plus',
  imageUrl: '/api/listing-media/' + image,
}
const listing = {
  id,
  listingChannel: 'shop',
  title: 'Camera',
  description: 'Public description',
  price: 4500,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  preferredPaymentMode: 'external',
  preferredFulfillment: 'ON_CAMPUS',
  meetingLocation: { label: 'Campus' },
  estimatedDeliveryFeeCents: 0,
  status: 'available',
  seller: { id, displayName: 'real_seller' },
  photoUrls: ['/api/listing-media/' + image],
  createdAt: '2026-10-19T00:00Z',
  updatedAt: '2026-10-19T00:00Z',
  publishedAt: '2026-10-19T00:00Z',
}
const page = { page: 1, hasNextPage: false, refreshAfterMs: 1000 }
let result,
  error,
  calls = [],
  options
process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:1'
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-only'
global.fetch = async () => {
  throw Error('Network forbidden')
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full).exports
  const module = { exports: {} }
  cache.set(full, module)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, jsx: 4, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@supabase/supabase-js')
        return {
          createClient: (url, key, opts) => {
            options = opts
            assert.equal(url, 'http://127.0.0.1:1')
            assert.equal(key, 'offline-only')
            return {
              rpc: async (name, args) => {
                calls.push({ name, args })
                return { data: result, error }
              },
            }
          },
        }
      if (name === 'next/head') return () => null
      if (name === '@/components/shops/shop-page')
        return { ShopPage: () => null }
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}
const source = load('lib/server/public-shop.ts'),
  handler = load('pages/api/public-shops/[[...segments]].ts').default
async function request(query = {}, method = 'GET') {
  const headers = {}
  const res = {
    setHeader: (k, v) => (headers[k] = v),
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
    { query, method, headers: { cookie: 'private-owner-cookie' } },
    res
  )
  assert.match(headers['Cache-Control'], /no-store/)
  return res
}
async function main() {
  result = {
    shops: [{ ...shop, email: 'must-not-leak', trialClaimed: true }],
    ...page,
  }
  assert.deepEqual(await source.getPublicShops(), { shops: [shop], ...page })
  assert.deepEqual(options.auth, {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  })
  assert(!options.cookies)
  assert.equal(calls[0].name, 'marketplace_public_shops')
  result = {
    state: 'available',
    shop: { ...shop, privateSetting: 'secret' },
    listings: [
      { ...listing, storage_bucket: 'private', expectedImageCount: 6 },
    ],
    ...page,
  }
  const detail = await source.getPublicShop('real_seller')
  assert.equal(detail.state, 'available')
  assert.deepEqual(detail.listings, [listing])
  assert.deepEqual(detail.shop, shop)
  assert(!JSON.stringify(detail).includes('privateSetting'))
  assert(!JSON.stringify(detail).includes('storage_bucket'))
  for (const state of ['unavailable', 'not_found']) {
    result = { state, shop, listings: [listing] }
    assert.deepEqual(await source.getPublicShop('real_seller'), { state })
    assert.deepEqual(await source.getPublicShopListing(id), { state })
  }
  const n = calls.length
  assert.deepEqual(await source.getPublicShop('../private'), {
    state: 'not_found',
  })
  assert.deepEqual(await source.getPublicShop('x'.repeat(21)), {
    state: 'not_found',
  })
  assert.equal(calls.length, n)
  result = { state: 'available', listing, refreshAfterMs: 1000 }
  assert.equal((await source.getPublicShopListing(id)).listing.id, id)
  result = {
    state: 'available',
    listing: {
      ...listing,
      photoUrls: ['https://storage.invalid/private-path'],
    },
    refreshAfterMs: 1000,
  }
  await assert.rejects(source.getPublicShopListing(id), (e) => e.status === 503)
  result = { shops: [], ...page }
  let r = await request()
  assert.equal(r.code, 200)
  assert.deepEqual(r.body.shops, [])
  assert.equal((await request({}, 'POST')).code, 405)
  assert.equal((await request({ q: '{' })).code, 400)
  assert.equal((await request({ q: ['{}', '{}'] })).code, 400)
  assert.equal((await request({ owner: id })).code, 400)
  error = { code: 'XX000', message: 'private diagnostic' }
  r = await request()
  assert.equal(r.code, 503)
  assert(!JSON.stringify(r.body).includes('private diagnostic'))
  error = { code: '23514' }
  assert.equal((await request()).code, 400)
  error = null
  const route = load('pages/shop/[username].tsx')
  const headers = {}
  const res = { setHeader: (k, v) => (headers[k] = v) }
  result = { state: 'unavailable' }
  assert.deepEqual(
    await route.getServerSideProps({
      params: { username: 'real_seller' },
      res,
    }),
    { props: { message: 'This shop is temporarily unavailable.' } }
  )
  result = { state: 'not_found' }
  assert.deepEqual(
    await route.getServerSideProps({
      params: { username: 'real_seller' },
      res,
    }),
    { notFound: true }
  )
  result = { state: 'available', shop, listings: [listing], ...page }
  assert.equal(
    (
      await route.getServerSideProps({
        params: { username: 'REAL_SELLER' },
        res,
      })
    ).redirect.destination,
    '/shop/real_seller'
  )
  const loaded = await route.getServerSideProps({
    params: { username: 'real_seller' },
    res,
  })
  assert.equal(loaded.props.result.shop.id, id)
  error = { code: 'XX000' }
  assert.equal(
    (
      await route.getServerSideProps({
        params: { username: 'real_seller' },
        res,
      })
    ).props.message,
    'Shop unavailable. Please retry.'
  )
  assert.equal(res.statusCode, 503)
  console.log(
    'PASS B15 public API/SSR: anonymous authority, whitelist, unavailable/not-found/error, canonical username, bounded transport and no Demo/private fallback'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
