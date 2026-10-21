// Actual activity endpoints and client retry helper. No environment file or network.
const fs = require('node:fs'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
let user = true,
  authError = null,
  origin = true,
  environment = true,
  fail = false
const calls = []
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const client = {
  auth: {
    getUser: async () => ({
      data: { user: user ? { id: 'actor' } : null },
      error: authError,
    }),
  },
  rpc: async (name, args) => {
    calls.push({ name, args })
    return {
      data: { recorded: true },
      error: fail ? { message: 'private secret' } : null,
    }
  },
}
const deps = {
  '@/lib/listing-validation': { ListingApiError: ApiError },
  '@/lib/server/financial-capabilities-service': {
    requireFinancialEnvironment() {
      if (!environment) throw new ApiError('env', 503)
    },
  },
  '@/lib/server/marketplace-auth': {
    requireSameOriginWrite() {
      if (!origin) throw new ApiError('origin', 403)
    },
  },
  '@/lib/server/messages-environment': {
    messageUuid(v) {
      if (typeof v !== 'string' || !/^[a-f0-9-]{36}$/.test(v))
        throw new ApiError('uuid')
      return v
    },
  },
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
}
function load(file, dependencies = deps) {
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (n) => {
      assert(n in dependencies, 'Unexpected import ' + n)
      return dependencies[n]
    },
    m,
    m.exports
  )
  return m.exports
}
async function invoke(handler, req) {
  const res = {
    headers: {},
    code: 200,
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
  await handler({ query: {}, ...req }, res)
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
  return res
}
async function main() {
  const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    event = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  for (const [file, subject, rpc, arg] of [
    [
      'pages/api/listings/view.ts',
      'listingId',
      'marketplace_record_listing_view',
      'p_listing_id',
    ],
    [
      'pages/api/shops/view.ts',
      'shopId',
      'marketplace_record_shop_view',
      'p_shop_id',
    ],
  ]) {
    const handler = load(file).default,
      body = { [subject]: id, eventId: event }
    let r = await invoke(handler, { method: 'POST', body })
    assert.equal(r.code, 200)
    assert.deepEqual(calls.at(-1), {
      name: rpc,
      args: { [arg]: id, p_event_id: event },
    })
    const count = calls.length
    user = false
    r = await invoke(handler, { method: 'POST', body })
    assert.deepEqual(r.body, { recorded: false })
    assert.equal(calls.length, count, 'anonymous never reaches RPC')
    authError = { name: 'AuthSessionMissingError' }
    assert.deepEqual((await invoke(handler, { method: 'POST', body })).body, {
      recorded: false,
    })
    authError = { name: 'ExpiredJWT' }
    assert.equal((await invoke(handler, { method: 'POST', body })).code, 401)
    authError = null
    user = true
    for (const bad of [
      { ...body, ownerId: id },
      { ...body, channel: 'shop' },
      { ...body, shopOriginId: id },
      { ...body, occurredAt: 'now' },
      [],
      {},
      null,
      { ...body, [subject]: 'bad' },
    ])
      assert.equal(
        (await invoke(handler, { method: 'POST', body: bad })).code,
        400
      )
    assert.equal(
      (await invoke(handler, { method: 'POST', body, query: { userId: id } }))
        .code,
      400
    )
    assert.equal((await invoke(handler, { method: 'GET' })).code, 405)
    origin = false
    assert.equal((await invoke(handler, { method: 'POST', body })).code, 403)
    origin = true
    environment = false
    assert.equal((await invoke(handler, { method: 'POST', body })).code, 503)
    environment = true
    fail = true
    r = await invoke(handler, { method: 'POST', body })
    assert.equal(r.code, 503)
    assert(!JSON.stringify(r.body).includes('secret'))
    fail = false
  }
  const requests = []
  let lost = true
  const helper = load('lib/record-marketplace-view.ts', {
    '@/lib/listings-api': {
      marketplaceRequest: async (path, method, body) => {
        requests.push({ path, method, body })
        if (lost) {
          lost = false
          throw Error('lost')
        }
        return { recorded: true }
      },
    },
  })
  await helper.recordMarketplaceView(id)
  assert.equal(requests.length, 2)
  assert.equal(requests[0].body.eventId, requests[1].body.eventId)
  assert.equal(requests[0].path, '/api/listings/view')
  await helper.recordShopView(id)
  assert.equal(requests.length, 3)
  assert.equal(requests[2].path, '/api/shops/view')
  assert.notEqual(requests[0].body.eventId, requests[2].body.eventId)
  assert.deepEqual(Object.keys(requests[2].body).sort(), ['eventId', 'shopId'])
  const broken = load('lib/record-marketplace-view.ts', {
    '@/lib/listings-api': {
      marketplaceRequest() {
        throw Error('sync failure')
      },
    },
  })
  await broken.recordShopView(id)
  console.log(
    'PASS B17 actual Listing/Shop view APIs: anonymous no RPC, authenticated identity, bounded exact subjects, methods/origin/environment/errors; shared UUID retry and failure isolation'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
