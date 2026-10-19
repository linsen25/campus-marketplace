// Offline fixture/media qualification. No hosted data, credentials, or environment files.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const ts = require('typescript')
const sharp = require('sharp')
const pictures = require('../scripts/lib/test-pictures.cjs')
const cache = new Map()
function load(filename) {
  const file = path.resolve(filename)
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (id) => {
      if (id.startsWith('@/')) return load(id.slice(2) + '.ts')
      if (id.startsWith('.'))
        return load(path.resolve(path.dirname(file), id) + '.ts')
      return require(id)
    },
    module,
    module.exports
  )
  return module.exports
}
async function run() {
  const { TEST_PICTURES, TEST_PICTURE_POOL, testPictureForFixture } = pictures
  assert.equal(TEST_PICTURE_POOL.length, 30)
  assert.equal(new Set(TEST_PICTURE_POOL).size, 30)
  const files = fs
    .readdirSync('public/static/testPic')
    .filter((f) => f.endsWith('.webp'))
  assert.equal(files.length, 30)
  const hashes = new Set()
  const sources = fs.readFileSync('public/static/testPic/SOURCES.md', 'utf8')
  for (const photo of TEST_PICTURE_POOL) {
    assert(photo.startsWith('/static/testPic/'))
    const bytes = fs.readFileSync('public' + photo)
    const meta = await sharp(bytes).metadata()
    assert.equal(meta.format, 'webp')
    assert.equal(Math.max(meta.width, meta.height), 1440)
    assert(bytes.length < 500000)
    hashes.add(crypto.createHash('sha256').update(bytes).digest('hex'))
    assert(sources.includes('## ' + path.basename(photo)))
  }
  assert.equal(hashes.size, 30, 'No duplicate physical photos')
  assert.equal(
    (sources.match(/- Source page: https:\/\/www\.pexels\.com\/photo\//g) || [])
      .length,
    30
  )
  assert.equal((sources.match(/- Photographer:/g) || []).length, 30)
  const registry = fs.readFileSync('lib/fixtures/test-pictures.ts', 'utf8')
  assert(!registry.includes('Math.random'))
  const originalRandom = Math.random
  try {
    Math.random = () => {
      throw Error('Nondeterministic fixture assignment')
    }
    for (let i = 0; i < 200; i++) {
      const id = 'explicit-fixture-' + i
      assert(TEST_PICTURE_POOL.includes(testPictureForFixture(id)))
      assert.equal(
        testPictureForFixture(id),
        pictures.testPictureForFixture(id)
      )
    }
    const market = load('lib/fixtures/market-layout.ts').marketPreviewListings
    assert.equal(market[0].images[0], TEST_PICTURES.laptop)
    assert.equal(market[1].images[0], TEST_PICTURES.monitor)
    assert.equal(market[6].images[0], TEST_PICTURES.deskLamp)
    const student = load('lib/fixtures/listings.ts').listingFixtures
    assert.equal(
      student.find((x) => x.id === 'student-monitor').photoUrls[0],
      TEST_PICTURES.monitor
    )
    const welcome = load(
      'lib/fixtures/homepage-listing-demo.ts'
    ).homepageListingDemo
    const shop = load('components/shops/shop-demo-data.ts')
    assert.equal(
      shop.demoShopProducts[0].listing.photoUrls[0],
      welcome.photoUrls[0]
    )
    assert.equal(welcome.photoUrls[0], TEST_PICTURES.chair)
    const recommended = load(
      'components/shops/recommended-shops-demo.ts'
    ).recommendedShopsDemo
    assert.equal(recommended[0].image, shop.lunaStudioDemo.image)
    assert.deepEqual(
      recommended.map((x) => x.image),
      [
        TEST_PICTURES.jewelry,
        TEST_PICTURES.chair,
        TEST_PICTURES.workspace,
        TEST_PICTURES.bookshelf,
        TEST_PICTURES.clothingDisplay,
      ]
    )
    for (const item of market) {
      assert(TEST_PICTURE_POOL.includes(item.images[0]))
      assert(!item.title.startsWith('[DEMO]'))
    }
    for (const item of shop.demoShopProducts)
      assert(TEST_PICTURE_POOL.includes(item.listing.photoUrls[0]))
    assert.equal(
      shop.demoShopProducts[3].listing.photoUrls[0],
      TEST_PICTURES.crochetBunny
    )
    assert.equal(
      shop.demoShopProducts[4].listing.photoUrls[0],
      TEST_PICTURES.phoneCase
    )
    assert.equal(
      shop.demoShopProducts[5].listing.photoUrls[0],
      TEST_PICTURES.toteBag
    )
    assert.equal(
      shop.demoShopProducts[7].listing.photoUrls[0],
      TEST_PICTURES.candle
    )
    for (const fixture of [
      'lib/fixtures/market-layout.ts',
      'lib/fixtures/hero-parallax-demo-products.ts',
      'lib/fixtures/listings.ts',
      'lib/fixtures/shop-analysis-fixture.ts',
      'components/shops/shop-demo-data.ts',
    ])
      assert(
        !fs.readFileSync(fixture, 'utf8').includes('testPictureForFixture'),
        'Known products use semantic photos: ' + fixture
      )

    assert(
      fs
        .readFileSync('components/listings/welcome-shop-demo-card.tsx', 'utf8')
        .includes('image: lunaStudioDemo.image')
    )
    assert(
      fs
        .readFileSync('components/shops/shop-detail-demo.tsx', 'utf8')
        .includes('demoShopProducts')
    )
    assert(
      fs
        .readFileSync('components/listings/home-listings.tsx', 'utf8')
        .includes('demoShopProducts')
    )
  } finally {
    Math.random = originalRandom
  }
  // An actual uploaded Listing goes through the original mapper unchanged.
  const { mapListing } = load('lib/supabase/listing-mapper.ts')
  const row = {
    id: 'real-listing',
    listing_channel: 'resale',
    profiles: { id: 'real-seller', display_name: 'Seller' },
    listing_images: [
      { path: 'real/second.webp', slot: 2, ready: true },
      { path: 'real/first.webp', slot: 1, ready: true },
      { path: 'real/pending.webp', slot: 0, ready: false },
    ],
  }
  const mapped = mapListing(row, (p) => 'https://uploads.example.test/' + p)
  assert.deepEqual(mapped.photoUrls, [
    'https://uploads.example.test/real/first.webp',
    'https://uploads.example.test/real/second.webp',
  ])
  assert.deepEqual(
    mapListing({ ...row, listing_images: [] }, (p) => p).photoUrls,
    []
  )
  // Renderers must never infer demos or substitute photos when uploads fail.
  for (const file of [
    'components/listings/listing-media.tsx',
    'components/listings/published-listing-card.tsx',
    'components/listings/resale-management-card.tsx',
    'components/home/messages-listing-preview.tsx',
    'components/home/order-list-presentation.tsx',
    'components/home/formal-v2-order-detail.tsx',
  ]) {
    const s = fs.readFileSync(file, 'utf8')
    assert(
      !s.includes('TEST_PICTURES') && !s.includes('testPictureForFixture'),
      file
    )
  }
  const jpeg = pictures.readTestPictureJpeg('chair')
  assert.equal((await sharp(jpeg).metadata()).format, 'jpeg')
  assert.equal(
    pictures.testPictureDataUrl('chair'),
    'data:image/webp;base64,' +
      fs.readFileSync('public' + TEST_PICTURES.chair).toString('base64')
  )
  console.log(
    'PASS 30 unique normalized/provenanced local photos; canonical registry; deterministic fixtures; Welcome/Shop shared identities; real uploaded media and empty states untouched; in-memory JPEG compatibility'
  )
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
