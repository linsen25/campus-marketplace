const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
class ListingApiError extends Error {
  constructor(message, status) {
    super(message)
    this.status = status
  }
}
const taxonomy = [
  'Electronics',
  'Home & Dorm',
  'Textbooks & School',
  'Clothing & Accessories',
  'Sports & Outdoors',
  'Bikes & Mobility',
  'Games & Hobbies',
  'Other',
]
let rows = [],
  authorized = true,
  csrf = true,
  rpcError = null,
  rpcCalls = []
const client = {
  from(table) {
    assert.equal(table, 'listings')
    return {
      select(field) {
        assert.equal(field, 'category')
        return {
          eq(key, value) {
            assert.equal(key, 'status')
            assert.equal(value, 'available')
            return {
              not(key, op, value) {
                assert.equal(key, 'published_at')
                assert.equal(op, 'is')
                assert.equal(value, null)
                return this
              },
              order() {
                return {
                  range: async (start, end) => ({
                    data: rows.slice(start, end + 1),
                    error: null,
                  }),
                }
              },
            }
          },
        }
      },
    }
  },
  rpc: async (name, input) => {
    rpcCalls.push({ name, input })
    return {
      data: {
        username: input.candidate,
        next_change_allowed_at: '2026-10-12T00:00:00Z',
      },
      error: rpcError,
    }
  },
}
const deps = {
  '@/lib/listing-validation': { ListingApiError },
  '@/lib/market-taxonomy': {
    marketTaxonomy: Object.fromEntries(taxonomy.map((c) => [c, []])),
  },
  '@/lib/server/auth-username': {
    requireUsername(value) {
      if (!/^[A-Za-z0-9_]{3,20}$/.test(value))
        throw new ListingApiError('Invalid username', 400)
      return value
    },
  },
  '@/lib/server/marketplace-auth': {
    requireMarketplaceUser: async () => {
      if (!authorized) throw new ListingApiError('Unauthorized', 401)
      return { id: 'own' }
    },
    requireSameOriginWrite: () => {
      if (!csrf) throw new ListingApiError('Invalid request', 403)
    },
  },
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
}
function load(file) {
  const out = {}
  new Function(
    'require',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
  )((name) => deps[name], out)
  return out.default
}
const categories = load('pages/api/profile/categories.ts'),
  username = load('pages/api/profile/username.ts')
const response = () => ({
  setHeader() {},
  status(code) {
    this.code = code
    return this
  },
  json(body) {
    this.body = body
    return this
  },
})
;(async () => {
  rows = Array.from({ length: 1004 }, (_, i) => ({
    category: i < 1001 ? 'Electronics' : 'Other',
  }))
  let res = response()
  await categories({ method: 'GET' }, res)
  assert.equal(res.code, 200)
  assert.equal(res.body[0].count, 1001)
  assert.equal(res.body[1].count, 3)
  assert.equal(res.body.length, 8)
  rows = []
  res = response()
  await categories({ method: 'GET' }, res)
  assert(res.body.every((r) => r.count === 0))
  rows = [{ category: 'sports-hobbies' }]
  res = response()
  await categories({ method: 'GET' }, res)
  assert.equal(res.code, 503)
  assert.match(res.body.error, /unavailable/)
  authorized = false
  res = response()
  await categories({ method: 'GET' }, res)
  assert.equal(res.code, 401)
  authorized = true
  res = response()
  await categories({ method: 'POST' }, res)
  assert.equal(res.code, 405)
  csrf = false
  res = response()
  await username({ method: 'POST', body: { username: 'Chris2' } }, res)
  assert.equal(res.code, 403)
  assert.equal(rpcCalls.length, 0)
  csrf = true
  res = response()
  await username({ method: 'POST', body: { username: 'Chris2' } }, res)
  assert.equal(res.code, 200)
  assert.deepEqual(rpcCalls, [
    { name: 'marketplace_change_username', input: { candidate: 'Chris2' } },
  ])
  rpcError = {
    code: 'P0001',
    message: 'You can change your username again on 2026-10-12.',
  }
  res = response()
  await username({ method: 'POST', body: { username: 'Chris3' } }, res)
  assert.equal(res.code, 400)
  assert.equal(res.body.error, rpcError.message)
  console.log(
    'PASS Profile APIs: paginated available category-only aggregation, empty/schema-drift error, auth/method guards, CSRF guard and authoritative username RPC/cooldown error'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
