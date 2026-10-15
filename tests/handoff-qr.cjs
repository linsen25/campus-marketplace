// Offline handoff API/error/cache contracts; no credentials or hosted requests.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  vm = require('node:vm')
const cache = new Map()
let rpcResult = { data: { verified: true }, error: null },
  authenticated = true
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(full, 'utf8'), {
      compilerOptions: { module: 1, target: 7 },
    }).outputText
  )(
    (name) => {
      if (name === '@/lib/server/financial-capabilities-service')
        return {
          requireFinancialEnvironment() {},
          createTrustedFinancialClient() {
            throw Error('Unexpected payment operation')
          },
        }
      if (name === '@/lib/server/marketplace-auth')
        return {
          async requireMarketplaceUser() {
            if (!authenticated)
              throw new (load('lib/listing-validation.ts').ListingApiError)(
                'Sign in.',
                401
              )
          },
          requireSameOriginWrite(req) {
            if (req.headers.origin !== 'http://localhost:3000')
              throw new (load('lib/listing-validation.ts').ListingApiError)(
                'Invalid origin.',
                403
              )
          },
        }
      if (name === '@/lib/server/messages-environment')
        return { messageUuid: (v) => v }
      if (name === '@/lib/supabase/server')
        return {
          createMarketplaceClient: () => ({ rpc: async () => rpcResult }),
        }
      return name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)
    },
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const handler = load('pages/api/order-domain/[id]/[operation].ts').default
async function invoke(result, origin = 'http://localhost:3000') {
  rpcResult = result
  const headers = {}
  const r = {
    code: 200,
    setHeader(k, v) {
      headers[k] = v
    },
    status(c) {
      this.code = c
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  await handler(
    {
      method: 'POST',
      headers: { origin },
      query: { id: 'fixture-order', operation: 'handoff' },
      body: {
        channel: 'qr',
        credential: 'a'.repeat(64),
        clientActionId: 'fixture-command',
      },
    },
    r
  )
  assert.equal(headers['Cache-Control'], 'private, no-store')
  assert(
    !JSON.stringify(r.body).includes('a'.repeat(64)),
    'No credential in error response'
  )
  return r
}
(async () => {
  for (const code of [
    'invalid_handoff_credential',
    'numeric_temporarily_locked',
    'handoff_already_redeemed',
  ]) {
    const retryAt = '2030-01-01T12:00:00Z',
      r = await invoke({
        data: { verified: false, errorCode: code, retryAt },
        error: null,
      })
    assert.equal(r.code, 409)
    assert.equal(r.body.errorCode, code)
    assert.equal(
      r.body.retryAt,
      code === 'numeric_temporarily_locked' ? retryAt : undefined
    )
    assert(!/payment method/.test(r.body.error))
  }
  for (const [error, expected] of [
    [{ code: '42501', message: 'private detail' }, 'handoff_unauthorized'],
    [
      {
        code: '23505',
        message: 'Cancellation or Case holds this transaction.',
      },
      'handoff_held',
    ],
    [
      { code: '23505', message: 'Start Seller Delivery before handoff.' },
      'handoff_not_ready',
    ],
    [
      { code: '23514', message: 'Paid handoff authorization required.' },
      'handoff_not_ready',
    ],
  ]) {
    const r = await invoke({ data: null, error })
    assert.equal(r.body.errorCode, expected)
    assert(!JSON.stringify(r.body).includes('private detail'))
  }
  authenticated = false
  assert.equal((await invoke({})).body.errorCode, 'handoff_unauthorized')
  authenticated = true
  assert.equal((await invoke({}, 'http://untrusted.invalid')).code, 403)
  assert.equal(
    (await invoke({ data: { verified: true }, error: null })).body.verified,
    true
  )
  const { actOnOrderFlow } = load('lib/order-flow-api.ts')
  let seen
  global.fetch = async (url, opts) => {
    seen = { url, opts }
    return new Response(
      JSON.stringify({
        errorCode: 'numeric_temporarily_locked',
        retryAt: '2030-01-01T12:00:00Z',
      }),
      { status: 409 }
    )
  }
  await assert.rejects(
    actOnOrderFlow('fixture-order', 'handoff', {
      channel: 'code',
      credential: '012345',
    }),
    (e) =>
      e.code === 'numeric_temporarily_locked' &&
      e.retryAt === '2030-01-01T12:00:00Z'
  )
  assert(!seen.url.includes('012345'))
  assert.equal(seen.opts.cache, 'no-store')
  assert.equal(seen.opts.credentials, 'same-origin')
  const context = {
    module: { exports: {} },
    process: { env: {} },
    self: { location: { origin: 'https://market.test' } },
    require(name) {
      if (name === 'next-compose-plugins') return (_, config) => config
      if (name === 'next-pwa/cache') return []
      return () => ({})
    },
  }
  vm.runInNewContext(fs.readFileSync('next.config.js', 'utf8'), context)
  const rules = context.module.exports.pwa.runtimeCaching
  for (const method of ['GET', 'POST'])
    for (const resource of ['credential', 'handoff']) {
      const rule = rules.find(
        (r) =>
          (r.method || 'GET') === method &&
          typeof r.urlPattern === 'function' &&
          r.urlPattern({
            url: new URL(
              'https://market.test/api/order-domain/fixture/' + resource
            ),
          })
      )
      assert.equal(rule.handler, 'NetworkOnly')
    }
  assert(
    !rules[0].urlPattern({
      url: new URL('https://other.test/api/order-domain/x/credential'),
    })
  )
  console.log(
    'PASS sanitized handoff codes/retryAt, actual route/service/client, origin/auth/no-store, GET+POST NetworkOnly; no hosted writes'
  )
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
