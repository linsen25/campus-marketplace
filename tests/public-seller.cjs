// Offline privacy/query/SSR and public-origin qualification. No hosted data.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const React = require('react'),
  { renderToStaticMarkup } = require('react-dom/server')
const id = '12345678-1234-4234-8234-123456789abc'
let absent = false,
  avatarPath = null,
  profileUsername = 'SellerFixture',
  failed = false,
  rows = [],
  reads = 0
const original = { ...process.env },
  originalFetch = global.fetch
Object.assign(process.env, {
  APP_ENV: 'staging',
  NEXT_PUBLIC_SUPABASE_URL: 'https://staging.example.test',
  NEXT_PUBLIC_SUPABASE_ANON_KEY: 'public-fixture-key',
})
delete process.env.UU_PUBLIC_STAGING_ORIGIN
function query(table) {
  const filters = []
  let start = 0,
    end = 24
  const q = {
    select(columns) {
      assert.equal(
        columns,
        table === 'profiles'
          ? 'id,username,display_name,avatar_path'
          : 'id,title,description,price_cents,currency,category,subcategory,condition,listing_channel,preferred_payment_mode,preferred_fulfillment,meeting_location,estimated_delivery_fee_cents,status,created_at,updated_at,published_at,listing_images(id,path,slot,ready,storage_bucket)'
      )
      return q
    },
    eq(key, value) {
      filters.push((row) => row[key] === value)
      return q
    },
    not(key, op, value) {
      assert.equal(op, 'is')
      assert.equal(value, null)
      filters.push((row) => row[key] !== null)
      return q
    },
    order() {
      return q
    },
    range(a, b) {
      start = a
      end = b
      return q
    },
    async maybeSingle() {
      const profile = {
        id,
        username: profileUsername,
        username_normalized: profileUsername.toLowerCase(),
      }
      return {
        data:
          absent || !filters.every((filter) => filter(profile))
            ? null
            : {
                id,
                username: profileUsername,
                display_name: 'Public Seller',
                avatar_path: avatarPath,
                email: 'DO_NOT_PUBLISH_EMAIL',
                legal_name: 'DO_NOT_PUBLISH_NAME',
              },
        error: failed ? {} : null,
      }
    },
    then(resolve, reject) {
      return Promise.resolve({
        data: rows
          .filter((row) => filters.every((f) => f(row)))
          .slice(start, end + 1),
        error: failed ? {} : null,
      }).then(resolve, reject)
    },
  }
  return q
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7, jsx: 4, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@supabase/supabase-js')
        return {
          createClient: (url, key, options) => {
            reads++
            assert.equal(key, 'public-fixture-key')
            assert.equal(options.auth.persistSession, false)
            return {
              from: query,
              storage: {
                from: () => ({
                  getPublicUrl: (photo) => ({
                    data: { publicUrl: 'https://images.example.test/' + photo },
                  }),
                }),
              },
            }
          },
        }
      if (name === '@/components/listings/published-listing-card')
        return {
          PublishedListingCard: ({ listing }) =>
            React.createElement(
              'div',
              { 'data-published-listing': listing.id },
              listing.title
            ),
        }
      if (name === 'next/head')
        return {
          __esModule: true,
          default: ({ children }) =>
            React.createElement(React.Fragment, null, children),
        }
      if (name === '@ui/link/link')
        return { Link: (props) => React.createElement('a', props) }
      if (name.endsWith('.css'))
        return {
          __esModule: true,
          default: new Proxy({}, { get: (_, key) => String(key) }),
        }
      if (name.startsWith('@/')) {
        const f = name.slice(2)
        return load(fs.existsSync(f + '.ts') ? f + '.ts' : f + '.tsx')
      }
      if (name.startsWith('.')) {
        const f = require('node:path').resolve(
          require('node:path').dirname(file),
          name
        )
        return load(fs.existsSync(f + '.ts') ? f + '.ts' : f + '.tsx')
      }
      return require(name)
    },
    m,
    m.exports
  )
  cache.set(file, m.exports)
  return m.exports
}
async function main() {
  const service = load('lib/server/public-seller.ts'),
    route = load('pages/seller/[id].tsx'),
    profile = load('lib/server/stripe-seller-profile.ts')
  const make = (n, patch = {}) => ({
    id: id.slice(0, -2) + String(n).padStart(2, '0'),
    seller_id: id,
    title: 'Public item ' + n,
    price_cents: 1200,
    currency: 'CAD',
    category: 'Electronics',
    subcategory: 'Cameras',
    condition: 'good',
    description: 'Public description',
    listing_channel: 'resale',
    preferred_payment_mode: 'uu_pay',
    preferred_fulfillment: 'ON_CAMPUS',
    meeting_location: 'User meeting label',
    estimated_delivery_fee_cents: 0,
    created_at: '2026-10-16',
    updated_at: '2026-10-16',
    status: 'available',
    published_at: '2026-10-16',
    listing_images: [
      { path: 'not-ready', slot: 0, ready: false },
      { path: 'ready', slot: 1, ready: true },
    ],
    email: 'DO_NOT_PUBLISH_EMAIL',
    ...patch,
  })
  rows = [
    make(1),
    make(2, { status: 'sold' }),
    make(3, { published_at: null }),
    make(4, { seller_id: 'another-seller' }),
  ]
  const seller = await service.getPublicSeller(id)
  assert.deepEqual(await service.getPublicSeller('sellerfixture'), seller)
  assert.deepEqual(await service.getPublicSeller('SELLERFIXTURE'), seller)
  assert.equal(await service.getPublicSeller('missing_seller'), null)
  profileUsername = 'demo_seller_a'
  assert.equal((await service.getPublicSeller('DEMO_SELLER_A')).identifier, id)
  assert.equal(await service.getPublicSeller('demo_seller_b'), null)
  assert.equal(await service.getPublicSeller('SellerFixture'), null)
  assert.equal((await service.getPublicSeller(id)).username, 'demo_seller_a')
  profileUsername = 'SellerFixture'
  assert.equal(seller.listings.length, 1)
  assert(seller.listings[0].photoUrls[0].endsWith('/ready'))
  const oldMedia = rows[0].listing_images
  rows[0].listing_images = [
    {
      id,
      path: 'private/path',
      slot: 1,
      ready: true,
      storage_bucket: 'listing-images-private',
    },
  ]
  assert.equal(
    (await service.getPublicSeller(id)).listings[0].photoUrls[0],
    '/api/listing-media/' + id
  )
  rows[0].listing_images = oldMedia

  assert.equal(seller.avatarUrl, null)
  avatarPath = id + '/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.webp'
  const withAvatar = await service.getPublicSeller(id)
  assert.equal(
    withAvatar.avatarUrl,
    '/api/profile/avatar/' + id + '?v=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  )
  assert(!('avatar_path' in withAvatar))
  avatarPath = null
  assert(
    !Object.values(seller.listings[0]).includes(undefined),
    'SSR-safe projection'
  )
  assert.equal(seller.listings[0].condition, 'good')
  assert.equal(seller.listings[0].category, 'Electronics')
  assert.equal(seller.listings[0].seller.displayName, 'Public Seller')
  assert.deepEqual(seller.listings[0].meetingLocation, {
    label: 'User meeting label',
  })
  assert(!JSON.stringify(seller).includes('DO_NOT_PUBLISH'))
  assert(!('email' in seller.listings[0]))
  assert(!JSON.stringify(seller).includes('DO_NOT_PUBLISH'))
  const markup = renderToStaticMarkup(
    React.createElement(route.default, { seller })
  )
  for (const label of [
    'Usual &amp; Unusual',
    'SellerFixture',
    'Seller on Usual',
    'Public item 1',
  ])
    assert(markup.includes(label))
  assert(!markup.includes('DO_NOT_PUBLISH'))
  rows = []
  assert(
    renderToStaticMarkup(
      React.createElement(route.default, {
        seller: await service.getPublicSeller(id),
      })
    ).includes('No active listings right now.')
  )
  rows = Array.from({ length: 26 }, (_, n) => make(n))
  const first = await service.getPublicSeller(id),
    second = await service.getPublicSeller(id, 2)
  assert.equal(first.listings.length, 24)
  assert(first.hasNextPage)
  assert.equal(second.listings.length, 2)
  const before = reads
  assert.equal(await service.getPublicSeller('../invalid'), null)
  assert.equal(await service.getPublicSeller(id, NaN), null)
  assert.equal(reads, before)
  const headers = {},
    res = { setHeader: (k, v) => (headers[k] = v) }
  absent = true
  assert.deepEqual(
    await route.getServerSideProps({ params: { id }, query: {}, res }),
    { notFound: true }
  )
  absent = false
  failed = true
  assert.deepEqual(
    await route.getServerSideProps({ params: { id }, query: {}, res }),
    { props: { seller: null } }
  )
  assert.equal(res.statusCode, 503)
  failed = false
  assert(headers['Cache-Control'].includes('no-store'))
  let fetches = 0
  global.fetch = async (url, options) => {
    fetches++
    assert.equal(url, 'https://uu-staging.example.org/seller/' + id)
    assert.equal(options.redirect, 'error')
    assert(!options.headers)
    return new Response(`<article data-public-seller-id="${id}"></article>`, {
      headers: { 'content-type': 'text/html' },
    })
  }
  assert.deepEqual(await profile.sellerOnboardingProfile(id), {
    product_description: profile.sellerProductDescription,
  })
  assert.equal(fetches, 0)
  for (const origin of [
    'http://localhost:3000',
    'https://localhost',
    'https://127.0.0.1',
    'https://example.test',
    'https://user:pass@staging.example.org',
    'https://staging.example.org/path',
  ]) {
    process.env.UU_PUBLIC_STAGING_ORIGIN = origin
    await assert.rejects(() => profile.sellerOnboardingProfile(id))
    assert.equal(fetches, 0)
  }
  // Fixture URL is intercepted above, never sent to Stripe or the network.
  process.env.UU_PUBLIC_STAGING_ORIGIN = 'https://uu-staging.example.org'
  assert.equal(
    (await profile.sellerOnboardingProfile(id)).business_url,
    'https://uu-staging.example.org/seller/' + id
  )
  global.fetch = async () => new Response('Login required', { status: 401 })
  await assert.rejects(() => profile.sellerOnboardingProfile(id))
  global.fetch = async () =>
    new Response('<html>Generic homepage</html>', {
      headers: { 'content-type': 'text/html' },
    })
  await assert.rejects(() => profile.sellerOnboardingProfile(id))
  console.log(
    'PASS anonymous public seller projection, active/published ownership filters, no private fields, empty/pagination/404/503 SSR, localhost rejection and exact public page validation'
  )
}
main()
  .catch((e) => {
    console.error(e)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = originalFetch
    for (const key of Object.keys(process.env))
      if (!(key in original)) delete process.env[key]
    Object.assign(process.env, original)
  })
