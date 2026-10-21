/* global Blob, structuredClone */
// Actual API + authorization service + mapper. No environment files or network.
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
const owner = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222',
  listingId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  imageId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const bytes = Buffer.from([255, 216, 255, 1]),
  bucket = 'listing-images-private'
let actor, row, downloads, mutation, backendError, authError, shopEligible
function reset(state = 'draft', user = null) {
  actor = user
  downloads = 0
  mutation = null
  backendError = false
  authError = false
  shopEligible = false
  row = {
    id: imageId,
    listing_id: listingId,
    owner_id: owner,
    path: `${owner}/${listingId}/${imageId}`,
    storage_bucket: bucket,
    ready: true,
    listings: {
      id: listingId,
      seller_id: owner,
      published_at: state === 'draft' ? null : '2026-10-19',
      status: state === 'sold' ? 'sold' : 'available',
      listing_channel: 'resale',
    },
  }
}
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: actor
          ? {
              id: actor,
              email: 'fixture@uwo.ca',
              email_confirmed_at: '2026-10-19',
            }
          : null,
      },
      error: authError ? {} : null,
    }),
  },
  from(table) {
    assert.equal(table, 'listing_images')
    const q = {
      select() {
        return q
      },
      eq(key, id) {
        assert.equal(key, 'id')
        if (id !== imageId)
          return { ...q, maybeSingle: async () => ({ data: null }) }
        return q
      },
      maybeSingle: async () => {
        return { data: row ? structuredClone(row) : null, error: null }
      },
    }
    return q
  },
}
const mocks = {
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
  '@/lib/server/chat-image-storage': {
    createChatStorage: () => ({
      rpc: async (name, args) => {
        assert.equal(name, 'marketplace_public_shop_image')
        assert.equal(args.p_image_id, imageId)
        return {
          data:
            shopEligible &&
            row?.ready &&
            row?.listings.published_at &&
            row?.listings.status === 'available'
              ? structuredClone(row)
              : null,
          error: null,
        }
      },
      storage: {
        from(source) {
          assert.equal(source, bucket)
          return {
            download: async (p) => {
              assert.equal(p, row.path)
              downloads++
              if (mutation) mutation()
              return {
                data: new Blob([bytes], { type: 'image/jpeg' }),
                error: backendError ? {} : null,
              }
            },
          }
        },
      },
    }),
  },
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  cache.set(full, m.exports)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (n) =>
      mocks[n] || (n.startsWith('@/') ? load(n.slice(2) + '.ts') : require(n)),
    m,
    m.exports
  )
  return m.exports
}
const handler = load('pages/api/listing-media/[imageId].ts').default
async function request(method = 'GET', id = imageId) {
  const headers = {}
  const res = {
    setHeader(k, v) {
      headers[k] = v
    },
    status(n) {
      this.code = n
      return this
    },
    json(v) {
      this.body = v
      return this
    },
    send(v) {
      this.body = v
      return this
    },
    end() {
      this.ended = true
      return this
    },
  }
  await handler(
    {
      method,
      query: { imageId: id, path: 'ignored', bucket: 'listing-images' },
      headers: {},
    },
    res
  )
  assert.match(headers['Cache-Control'], /private, no-store/)
  assert(!headers.Location)
  return { res, headers }
}
async function main() {
  global.fetch = async () => {
    throw Error('Network forbidden')
  }
  for (const [state, user, allowed] of [
    ['draft', owner, true],
    ['draft', other, false],
    ['draft', null, false],
    ['published', null, true],
    ['published', other, true],
    ['sold', owner, true],
    ['sold', other, false],
    ['sold', null, false],
  ]) {
    reset(state, user)
    const { res, headers } = await request()
    assert.equal(res.code, allowed ? 200 : 404, `${state}/${user}`)
    assert.equal(downloads, allowed ? 1 : 0)
    if (allowed) {
      assert(res.body.equals(bytes))
      assert.equal(headers['Content-Type'], 'image/jpeg')
    } else assert.deepEqual(res.body, { error: 'Image not found.' })
  }
  reset('draft', owner)
  row.ready = false
  assert.equal((await request()).res.code, 404)
  assert.equal(downloads, 0)
  reset()
  row = null
  assert.equal((await request()).res.code, 404)
  reset()
  assert.equal((await request('GET', '../anything')).res.code, 404)
  assert.equal(downloads, 0)
  reset('draft', owner)
  authError = true
  assert.equal((await request()).res.code, 404)
  assert.equal(downloads, 0)
  reset('published')
  row.path = 'arbitrary/secret'
  assert.equal((await request()).res.code, 404)
  assert.equal(downloads, 0)
  reset('published')
  row.storage_bucket = 'other-bucket'
  assert.equal((await request()).res.code, 404)
  assert.equal(downloads, 0)
  reset('published')
  row.listings.listing_channel = 'shop'
  assert.equal((await request()).res.code, 404)
  assert.equal(downloads, 0)
  for (const state of ['draft', 'published', 'sold']) {
    reset(state, owner)
    row.listings.listing_channel = 'shop'
    assert.equal(
      (await request()).res.code,
      200,
      'B14 owner reads private Shop media without a public grant'
    )
    assert.equal(downloads, 1)
  }
  reset('published')
  mutation = () => {
    row = null
  }
  assert.equal((await request()).res.code, 404)
  for (const user of [null, other]) {
    reset('published', user)
    row.listings.listing_channel = 'shop'
    shopEligible = true
    assert.equal(
      (await request()).res.code,
      200,
      'B15 eligible Shop media uses restricted resolver'
    )
    assert.equal(downloads, 1)
    mutation = () => {
      shopEligible = false
    }
    assert.equal(
      (await request()).res.code,
      404,
      'expiry during download denies bytes'
    )
  }
  reset('draft')
  row.listings.listing_channel = 'shop'
  shopEligible = true
  assert.equal(
    (await request()).res.code,
    404,
    'public resolver cannot open drafts'
  )
  reset('published')
  mutation = () => {
    row.listings.status = 'sold'
  }
  assert.equal((await request()).res.code, 404)
  reset('published')
  backendError = true
  assert.equal((await request()).res.code, 404)
  reset('published')
  let r = await request('HEAD')
  assert.equal(r.res.code, 200)
  assert(r.res.ended)
  assert.equal(r.res.body, undefined)
  reset('published')
  assert.equal((await request('POST')).res.code, 405)
  assert.equal(downloads, 0)
  const { listingImageUrl, listingImageBucket } = load('lib/listing-media.ts')
  assert.equal(
    listingImageUrl(
      { path: 'old/path', storage_bucket: 'listing-images' },
      (p) => 'https://legacy/' + p
    ),
    'https://legacy/old/path'
  )
  assert.equal(
    listingImageUrl(
      { id: imageId, path: 'private', storage_bucket: bucket },
      () => {
        throw Error('must not generate public URL')
      }
    ),
    '/api/listing-media/' + imageId
  )
  assert.throws(
    () => listingImageBucket({ path: 'x', storage_bucket: 'forged' }),
    /Invalid/
  )
  const config = fs.readFileSync('next.config.js', 'utf8')
  const cacheLine = config
    .split(/\r?\n/)
    .find((line) => line.includes('public-shops') && line.includes('.test('))
    .trim()
  const cachePattern = new Function(
    'return ' + cacheLine.slice(0, cacheLine.indexOf('.test('))
  )()
  for (const url of [
    '/api/listing-media/identity',
    '/api/listing-images',
    '/api/public-shops',
    '/shop/real_seller',
  ])
    assert(cachePattern.test(url), 'NetworkOnly route ' + url)
  console.log(
    'PASS image API: Draft/Published/Sold/Deleted roles, uniform 404, ready/current identity, no path injection/signing/redirect, HEAD, download race recheck, legacy URL unchanged and PWA NetworkOnly'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
