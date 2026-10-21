// Actual Offer API/service + snapshot copier, in-memory transport only; zero network.
/* global Blob, structuredClone */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  crypto = require('node:crypto')
const { readTestPictureJpeg } = require('../scripts/lib/test-pictures.cjs')
const uid = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const actor = uid(1),
  offer = uid(2),
  command = uid(3),
  order = uid(4),
  batchId = uid(5)
const image = readTestPictureJpeg('chair'),
  sha = crypto.createHash('sha256').update(image).digest('hex')
function harness(options = {}) {
  const calls = [],
    objects = new Map(),
    verified = new Set(),
    cache = new Map()
  let committed = false,
    failUpload = options.failUpload,
    corrupt = options.corrupt,
    prepareCount = 0
  const batch = {
    id: batchId,
    state: 'preparing',
    assets: [1, 2].map((n) => ({
      id: uid(10 + n),
      source_bucket: n === 1 ? 'listing-images-private' : 'listing-images',
      source_path: `source/${n}`,
      path: `${batchId}/${uid(10 + n)}`,
    })),
  }
  let errorClass
  const backend = {
    rpc: async (name, params) => {
      calls.push({ name, params })
      if (name === 'marketplace_prepare_order_media') {
        prepareCount++
        return { data: structuredClone(batch) }
      }
      if (name === 'marketplace_verify_order_media') {
        assert.equal(params.p_sha, sha)
        assert.equal(params.p_size, image.length)
        verified.add(params.p_asset)
        if (verified.size === 2) batch.state = 'prepared'
        return { data: structuredClone(batch) }
      }
      if (name === 'marketplace_offer_accept_preflight') {
        assert.equal(params.p_offer_id, offer)
        assert.equal(params.p_client_action_id, command)
        if (options.rpcError) return { error: options.rpcError }
        if (options.reason) return { data: { errorCode: options.reason } }
        return { data: committed ? { orderId: order } : { ready: true } }
      }
      if (name === 'marketplace_order_detail')
        return {
          data: { order: { id: order, buyer_id: uid(6), seller_id: actor } },
        }
      if (name === 'marketplace_accept_offer') {
        assert.equal(params.p_media_batch, batchId)
        assert.equal(batch.state, 'prepared')
        if (options.acceptError) return { error: options.acceptError }
        committed = true
        if (options.loseAcceptResponse) {
          options.loseAcceptResponse = false
          return {
            error: { code: '08006', message: 'PRIVATE_PROVIDER_DETAIL' },
          }
        }
        return { data: { id: order, buyer_id: uid(6), seller_id: actor } }
      }
      throw Error('Unexpected RPC: ' + name)
    },
    storage: {
      from: (bucket) => ({
        info: async (key) =>
          objects.has(key) ? { data: {} } : { error: { statusCode: 404 } },
        upload: async (key, bytes, opts) => {
          assert.equal(bucket, 'order-snapshot-media')
          assert.equal(opts.upsert, false)
          calls.push({ name: 'upload', key })
          if (key === failUpload) return { error: { statusCode: 503 } }
          if (objects.has(key)) return { error: { statusCode: 409 } }
          objects.set(key, Buffer.from(bytes))
          return { data: { path: key } }
        },
        download: async (key) => {
          calls.push({ name: 'download', bucket, key })
          const data =
            bucket === 'order-snapshot-media' ? objects.get(key) : image
          return data
            ? {
                data: new Blob(
                  [key === corrupt ? Buffer.from([255, 216, 255, 1]) : data],
                  { type: 'image/jpeg' }
                ),
              }
            : { error: { statusCode: 404 } }
        },
      }),
    },
  }
  const mocks = {
    '@/lib/supabase/server': { createMarketplaceClient: () => backend },
    '@/lib/server/chat-image-storage': { createChatStorage: () => backend },
    '@/lib/server/order-request-service': {
      requireOrderRequestEnvironment: () => {},
    },
    '@/lib/server/marketplace-auth': {
      requireMarketplaceUser: async () => {
        if (options.unauthenticated)
          throw new errorClass('Sign in required.', 401)
        return { id: actor }
      },
      requireSameOriginWrite: () => {}, // real CSRF guard covered by offers-api.cjs
    },
  }
  function load(file) {
    const full = path.resolve(file)
    if (cache.has(full)) return cache.get(full).exports
    const mod = { exports: {} }
    cache.set(full, mod)
    const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: 1, target: 7, esModuleInterop: true },
    }).outputText
    new Function('require', 'module', 'exports', code)(
      (name) => {
        if (mocks[name]) return mocks[name]
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
        if (name.startsWith('.'))
          return load(path.resolve(path.dirname(full), name) + '.ts')
        return require(name)
      },
      mod,
      mod.exports
    )
    return mod.exports
  }
  errorClass = load('lib/listing-validation.ts').ListingApiError
  const service = load('lib/server/offers-service.ts').createOffersService({})
  const handler = load('pages/api/offers/[[...segments]].ts').default
  async function invoke(body = { clientActionId: command }) {
    const res = {
      code: 200,
      headers: {},
      setHeader(k, v) {
        this.headers[k] = v
      },
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
      { method: 'POST', query: { segments: [offer, 'accept'] }, body },
      res
    )
    return res
  }
  return {
    service,
    invoke,
    calls,
    objects,
    batch,
    get prepareCount() {
      return prepareCount
    },
    clearFault() {
      failUpload = null
      corrupt = null
    },
  }
}
async function main() {
  const previous = { ...process.env }
  process.env.APP_ENV = 'staging'
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    'https://pcaqxezdfxofysghssyo.supabase.co'
  const network = global.fetch
  global.fetch = () => {
    throw Error('Network forbidden in local B07 test')
  }
  try {
    let h = harness({ unauthenticated: true })
    assert.equal((await h.invoke()).code, 401)
    assert.equal(h.calls.length, 0)
    h = harness({
      rpcError: { code: '42501', message: 'PRIVATE_PROVIDER_DETAIL' },
    })
    assert.equal((await h.invoke()).code, 403)
    assert.equal(h.prepareCount, 0)
    h = harness({
      rpcError: { code: 'P0001', message: 'seller_payout_not_ready' },
    })
    let response = await h.invoke()
    assert.equal(response.code, 409)
    assert.equal(response.body.code, 'seller_payout_not_ready')
    assert.equal(h.prepareCount, 0)
    for (const reason of [
      'listing_changed',
      'asking_price_lower',
      'offer_not_active',
    ]) {
      h = harness({ reason })
      assert.equal((await h.invoke()).code, 409)
      assert.equal(h.prepareCount, 0)
    }
    h = harness()
    response = await h.invoke({ clientActionId: command, senderId: actor })
    assert.equal(response.code, 400)
    assert.equal(h.calls.length, 0)
    h = harness()
    assert.equal((await h.invoke({ clientActionId: 'bad-id' })).code, 400)
    assert.equal(h.calls.length, 0)
    h = harness({ failUpload: `${batchId}/${uid(12)}` })
    response = await h.invoke()
    assert.equal(response.code, 503)
    assert.equal(h.objects.size, 1)
    assert(!h.calls.some((c) => c.name === 'marketplace_accept_offer'))
    h.clearFault()
    response = await h.invoke()
    assert.equal(response.code, 200)
    assert.equal(h.objects.size, 2)
    assert.equal(
      h.calls.filter((c) => c.name === 'upload' && c.key.endsWith(uid(11)))
        .length,
      1
    )
    assert(
      h.calls.some(
        (c) => c.name === 'download' && c.bucket === 'listing-images-private'
      )
    )
    assert(
      h.calls.some(
        (c) => c.name === 'download' && c.bucket === 'listing-images'
      )
    )
    h = harness({ corrupt: `${batchId}/${uid(11)}` })
    assert.equal((await h.invoke()).code, 503)
    assert(!h.calls.some((c) => c.name === 'marketplace_accept_offer'))
    assert(!h.calls.some((c) => c.name === 'marketplace_verify_order_media'))
    h = harness({ loseAcceptResponse: true })
    response = await h.invoke()
    assert.equal(response.code, 503)
    assert(!response.body.error.includes('PRIVATE_PROVIDER_DETAIL'))
    const count = h.prepareCount
    response = await h.invoke()
    assert.equal(response.code, 200)
    assert.equal(response.body.orderId, order)
    assert.equal(h.prepareCount, count)
    assert.equal(
      h.calls.filter((c) => c.name === 'marketplace_accept_offer').length,
      1
    )
    h = harness({
      acceptError: { code: '23505', message: 'PRIVATE_PROVIDER_DETAIL' },
    })
    response = await h.invoke()
    assert.equal(response.code, 409)
    assert(!response.body.error.includes('PRIVATE_PROVIDER_DETAIL'))
    assert.equal(response.headers['Cache-Control'], 'private, no-store')
    console.log(
      'PASS B07 actual Offer API/service/copier: auth and recipient preflight, forgery/UUID guards, payout gate propagation, partial copy retry, immutable targets, SHA mismatch blocks Accept, committed response-loss replay skips media, safe conflict errors; zero network'
    )
  } finally {
    global.fetch = network
    for (const key of Object.keys(process.env))
      if (!(key in previous)) delete process.env[key]
    Object.assign(process.env, previous)
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
