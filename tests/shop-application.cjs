// Mock-only contract test for the Shop application route.  It exercises the
// HTTP boundary and session/same-origin rules; database approval remains a
// separate PostgreSQL concern and is not marked PASS here.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

let actor = 'buyer-a'
let confirmed = true
let sameOrigin = true
let rpcResult = { data: 'pending', error: null }
const calls = []
class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: actor
          ? {
              id: actor,
              email: `${actor}@example.com`,
              email_confirmed_at: confirmed ? 'now' : null,
            }
          : null,
      },
      error: null,
    }),
  },
  rpc(name) {
    calls.push(name)
    return Promise.resolve(rpcResult)
  },
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText
  new Function('require', 'module', 'exports', output)(
    (name) => {
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (name === '@/lib/listing-validation') return { ListingApiError }
      if (name === '@/lib/server/marketplace-auth')
        return {
          requireMarketplaceUser: async () => {
            const result = await client.auth.getUser()
            if (!result.data.user)
              throw new ListingApiError('Sign in required.', 401)
            if (!result.data.user.email_confirmed_at)
              throw new ListingApiError('Email confirmation required.', 403)
            return result.data.user
          },
          requireSameOriginWrite: () => {
            if (!sameOrigin)
              throw new ListingApiError('Cross-origin write denied.', 403)
          },
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}
const handler = load('pages/api/shop/application.ts').default
async function request(method, body, headers = {}) {
  const response = {
    code: 200,
    body: null,
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
    {
      method,
      body,
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        'x-marketplace-request': '1',
        ...headers,
      },
    },
    response
  )
  return response
}

async function main() {
  actor = null
  assert.equal((await request('POST', {})).code, 401)
  actor = 'buyer-a'
  confirmed = false
  assert.equal((await request('POST', {})).code, 403)
  confirmed = true
  sameOrigin = false
  assert.equal((await request('POST', {})).code, 403)
  sameOrigin = true
  for (const body of [
    null,
    [],
    { owner_id: 'buyer-b' },
    { status: 'approved' },
  ])
    assert.equal((await request('POST', body)).code, 400)
  assert.equal((await request('POST', {})).code, 200)
  assert.deepEqual(calls, ['marketplace_request_shop_application'])
  rpcResult = { data: 'pending', error: null }
  assert.equal((await request('POST', {})).body.status, 'pending')
  rpcResult = { data: 'rejected', error: null }
  assert.equal((await request('POST', {})).body.status, 'rejected')
  rpcResult = { data: null, error: { code: '42501', message: 'private' } }
  assert.equal((await request('POST', {})).code, 403)
  console.log(
    'PASS Shop application mock: session identity, confirmation, same-origin, input whitelist, duplicate/status response and approval denial'
  )
  console.log('NOT TESTED database/RLS/admin approval and real email delivery')
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
