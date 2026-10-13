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
                  data: { notifications: [], unreadCount: 0 },
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
const handler = load('pages/api/notifications.ts').default
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
  assert.equal(await request('GET'), 200)
  assert.deepEqual(calls[0], {
    name: 'marketplace_notifications',
    params: { p_before: null, p_before_id: null },
  })
  assert.equal(await request('GET', { userId: id }), 400)
  assert.equal(calls.length, 0)
  assert.equal(await request('GET', { before: 'invalid', beforeId: id }), 400)
  assert.equal(await request('GET', { beforeId: id }), 400)
  assert.equal(await request('POST', {}, { id }), 200)
  assert.deepEqual(calls[0], {
    name: 'marketplace_mark_notification_read',
    params: { p_id: id },
  })
  assert.equal(await request('POST', {}, { id, recipient: id }), 400)
  assert.equal(calls.length, 0)
  sameOrigin = false
  assert.equal(await request('POST', {}, { id }), 403)
  assert.equal(calls.length, 0)
  sameOrigin = true
  authenticated = false
  assert.equal(await request('GET'), 401)
  assert.equal(calls.length, 0)
  authenticated = true
  environment = false
  assert.equal(await request('GET'), 503)
  assert.equal(calls.length, 0)
  environment = true
  rpcError = { code: '42501', message: 'must never expose this diagnostic' }
  assert.equal(await request('POST', {}, { id }), 403)
  rpcError = null
  assert.equal(await request('DELETE'), 405)
  assert.equal(calls.length, 0)
  console.log(
    'PASS Notifications API: exact staging guard, session, no-store, CSRF, identity rejection, cursor, safe errors; no network'
  )
}
main().catch((error) => {
  console.error(error)
  process.exit(1)
})
