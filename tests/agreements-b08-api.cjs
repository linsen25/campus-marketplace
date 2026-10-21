// No network or fixtures: exercise the actual API/service with mocked session/RPC.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const ts = require('typescript')
const cache = new Map()
let environment = true,
  authenticated = true,
  calls = [],
  rpcError = null,
  rpcData = { notifications: [], unreadCount: 0 },
  trustedCalls = [],
  sameOrigin = true
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  cache.set(full, module.exports)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      const ApiError = () => load('lib/listing-validation.ts').ListingApiError
      if (name === '@/lib/server/financial-capabilities-service')
        return {
          createTrustedFinancialClient() {
            return {
              async rpc(name, params) {
                trustedCalls.push({ name, params })
                return { data: { status: 'paid' }, error: null }
              },
            }
          },
          requireFinancialEnvironment() {
            if (!environment) throw new (ApiError())('Staging required.', 503)
          },
        }
      if (name === '@/lib/server/marketplace-auth')
        return {
          async requireMarketplaceUser() {
            if (!authenticated) throw new (ApiError())('Sign in.', 401)
          },
          requireSameOriginWrite() {
            if (!sameOrigin) throw new (ApiError())('Origin rejected.', 403)
          },
        }
      if (name === '@/lib/supabase/server')
        return {
          createMarketplaceClient() {
            return {
              async rpc(name, params) {
                calls.push({ name, params })
                return {
                  data: rpcData,
                  error: rpcError,
                }
              },
            }
          },
        }
      if (name === '@/lib/server/messages-environment')
        return {
          messageUuid(value) {
            if (typeof value !== 'string' || !/^[a-f0-9-]{36}$/.test(value))
              throw new (ApiError())('Invalid UUID.')
            return value
          },
        }
      return name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)
    },
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
const handler = load('pages/api/order-domain/[id]/[operation].ts').default
async function request(method, query = {}, body = {}) {
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(v) {
      this.code = v
      return this
    },
    json(v) {
      this.body = v
      return this
    },
  }
  calls = []
  await handler({ method, query, body }, response)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
  return response.code
}
async function main() {
  const query = { id, operation: 'agreement' }
  assert.equal(await request('GET', query), 200)
  assert.deepEqual(calls, [
    { name: 'marketplace_order_agreement', params: { p_order_id: id } },
  ])
  rpcData = {
    orderId: id,
    buyerConfirmedAt: 'confirmed',
    sellerConfirmedAt: null,
    complete: false,
  }
  for (let i = 0; i < 2; i++) {
    assert.equal(
      await request('POST', { id, operation: 'confirm-agreement' }),
      200
    )
    assert.deepEqual(calls, [
      {
        name: 'marketplace_confirm_order_agreement',
        params: { p_order_id: id },
      },
    ])
  }
  for (const body of [
    { buyerConfirmedAt: 'forged' },
    { sellerConfirmedAt: 'forged' },
    { terms: {} },
    { preservedProgress: true },
    { paymentStatus: 'paid' },
    { orderId: id },
  ]) {
    assert.equal(
      await request('POST', { id, operation: 'confirm-agreement' }, body),
      400
    )
    assert.equal(calls.length, 0)
  }
  assert.equal(
    await request('POST', { id: 'invalid', operation: 'confirm-agreement' }),
    400
  )
  sameOrigin = false
  assert.equal(
    await request('POST', { id, operation: 'confirm-agreement' }),
    403
  )
  assert.equal(calls.length, 0)
  sameOrigin = true
  authenticated = false
  assert.equal(
    await request('POST', { id, operation: 'confirm-agreement' }),
    401
  )
  assert.equal(calls.length, 0)
  authenticated = true
  environment = false
  assert.equal(await request('GET', query), 503)
  environment = true
  for (const [code, status] of [
    ['42501', 403],
    ['23505', 409],
    ['23514', 400],
    ['08006', 503],
  ]) {
    rpcError = { code, message: 'SECRET_DATABASE_DETAIL' }
    assert.equal(
      await request('POST', { id, operation: 'confirm-agreement' }),
      status
    )
  }
  rpcError = null
  assert.equal(
    await request('POST', { id, operation: 'confirm-agreement' }),
    200
  )
  assert.equal(
    trustedCalls.length,
    0,
    'Agreement never creates trusted payment resolver'
  )
  console.log(
    'PASS B08 actual Agreement API/service routing, session/CSRF/body guards, repeated requests, safe errors/retry; no financial resolver or network'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
