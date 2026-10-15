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
  const query = { id, operation: 'economics' }
  assert.equal(await request('GET', query), 200)
  assert.deepEqual(calls[0], {
    name: 'marketplace_order_economics',
    params: { p_order_id: id },
  })
  assert.equal(
    await request('POST', { id, operation: 'payment' }, { clientActionId: id }),
    200
  )
  assert.deepEqual(calls[0], {
    name: 'marketplace_start_order_payment',
    params: { p_order_id: id, p_client_action_id: id },
  })
  assert.equal(
    await request(
      'POST',
      { id, operation: 'payment' },
      { clientActionId: id, amount: 1 }
    ),
    400
  )
  assert.equal(calls.length, 0)
  assert.equal(
    await request(
      'POST',
      { id, operation: 'handoff' },
      { channel: 'qr', credential: 'opaque-fixture', clientActionId: id }
    ),
    200
  )
  assert.equal(calls[0].name, 'marketplace_verify_handoff')
  for (const [operation, name, body, params] of [
    [
      'start-delivery',
      'marketplace_start_seller_delivery',
      { clientActionId: id },
      { p_order_id: id, p_client_action_id: id },
    ],
    [
      'request-cancellation',
      'marketplace_request_delivery_full_refund',
      { clientActionId: id, reason: 'seller_fault', note: 'Fixture' },
      {
        p_order_id: id,
        p_client_action_id: id,
        p_reason: 'seller_fault',
        p_note: 'Fixture',
      },
    ],
    [
      'respond-cancellation',
      'marketplace_respond_delivery_cancellation',
      { clientActionId: id, response: 'dispute' },
      { p_order_id: id, p_client_action_id: id, p_response: 'dispute' },
    ],
  ]) {
    assert.equal(await request('POST', { id, operation }, body), 200)
    assert.deepEqual(calls[0], { name, params })
    assert.equal(
      await request('POST', { id, operation }, { ...body, refundAmount: 1 }),
      400
    )
    assert.equal(calls.length, 0)
  }
  assert.equal(await request('GET', { id, operation: 'cancellation' }), 200)
  assert.equal(calls[0].name, 'marketplace_order_cancellation_state')
  rpcData = { attemptId: id, status: 'processing' }
  trustedCalls = []
  assert.equal(
    await request('POST', { id, operation: 'payment' }, { clientActionId: id }),
    200
  )
  assert.deepEqual(trustedCalls, [
    {
      name: 'marketplace_resolve_campus_payment',
      params: { p_attempt_id: id, p_success: true },
    },
  ])
  rpcData = { notifications: [], unreadCount: 0 }
  assert.equal(
    await request(
      'POST',
      { id, operation: 'resolve-paid' },
      { clientActionId: id }
    ),
    404
  )
  assert.equal(calls.length, 0)
  assert.equal(await request('GET', { id, operation: 'missing' }), 404)
  sameOrigin = false
  assert.equal(await request('POST', { id, operation: 'checkout' }), 403)
  assert.equal(calls.length, 0)
  sameOrigin = true
  authenticated = false
  assert.equal(await request('GET', query), 401)
  assert.equal(calls.length, 0)
  authenticated = true
  environment = false
  assert.equal(await request('GET', query), 503)
  assert.equal(calls.length, 0)
  environment = true
  rpcError = { code: '42501', message: 'must never expose diagnostic' }
  assert.equal(await request('GET', query), 403)
  rpcError = null
  assert.equal(await request('DELETE', query), 405)
  console.log(
    'PASS Order domain API: session, exact staging guard, no-store, CSRF, financial-input rejection, no client Paid resolver, safe errors; no network'
  )
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
