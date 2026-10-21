// Actual routes, repository and validation; controlled Auth/RPC transport only.
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
const id = '18111111-1111-4111-8111-111111111111',
  shopId = '18222222-2222-4222-8222-222222222222'
let actor = 'owner',
  verified = true,
  rpcError = null,
  result,
  calls = []
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: actor
          ? {
              id: actor,
              email: 'test@uwo.ca',
              email_confirmed_at: verified ? 'yes' : null,
            }
          : null,
      },
      error: null,
    }),
  },
  rpc: async (name, args) => {
    calls.push({ name, args, actor })
    return { data: result, error: rpcError }
  },
}
const cache = new Map()
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
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (name.startsWith('@/') || name.startsWith('.')) {
        let f = name.startsWith('@/')
          ? path.resolve(name.slice(2))
          : path.resolve(path.dirname(full), name)
        if (!path.extname(f)) f += '.ts'
        return load(f)
      }
      return require(name)
    },
    mod,
    mod.exports
  )
  return mod.exports
}
const handler = load('pages/api/shop/analysis.ts').default
async function request(handler, method, query, body, headers = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(n) {
      this.statusCode = n
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
  await handler(
    {
      method,
      query,
      body,
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
        ...headers,
      },
    },
    res
  )
  assert.match(res.headers['Cache-Control'], /no-store/)
  return res
}
async function main() {
  const fixture = require('./shop-analysis-b19-fixture.cjs')
  for (const access of ['plus', 'pro', 'trial'])
    for (const range of ['week', 'month', 'last-month', 'year']) {
      result = fixture(access, range)
      result.secret = 'PRIVATE'
      result.current.coverage.owner = 'PRIVATE'
      result.pro.products[0].buyer = 'PRIVATE'
      const r = await request(handler, 'GET', { range })
      assert.equal(r.statusCode, 200)
      assert.equal(r.body.source, 'real')
      assert.equal(r.body.access, access)
      assert.equal(r.body.pro.products.length, 1)
      assert.equal(r.body.pro.featured, null)
      assert(!JSON.stringify(r.body).includes('PRIVATE'))
      assert.deepEqual(calls.at(-1).args, { p_range: range })
      assert.equal(calls.at(-1).name, 'marketplace_shop_analysis')
    }
  for (const query of [
    {},
    { range: ['month'] },
    { range: 'all' },
    { range: 'month', ownerId: id },
    { range: 'month', tier: 'pro' },
    { range: 'month', asOf: '2020-01-01' },
    { range: 'month', shopId },
  ])
    assert.equal((await request(handler, 'GET', query)).statusCode, 400)
  assert.equal(
    (await request(handler, 'POST', { range: 'month' })).statusCode,
    405
  )
  actor = null
  assert.equal(
    (await request(handler, 'GET', { range: 'month' })).statusCode,
    401
  )
  actor = 'owner'
  verified = false
  assert.equal(
    (await request(handler, 'GET', { range: 'month' })).statusCode,
    403
  )
  verified = true
  rpcError = { code: '42501', message: 'SECRET_SHOP' }
  assert.equal(
    (await request(handler, 'GET', { range: 'month' })).statusCode,
    403
  )
  rpcError = { code: '22003', message: 'SECRET_DB' }
  let r = await request(handler, 'GET', { range: 'month' })
  assert.equal(r.statusCode, 503)
  assert(!JSON.stringify(r.body).includes('SECRET'))
  rpcError = null
  for (const mutation of [
    (x) => (x.source = 'fixture'),
    (x) => (x.access = 'admin'),
    (x) => (x.current.revenueCents = Number.MAX_SAFE_INTEGER + 1),
    (x) => (x.current.coverage.externalCents = 0),
    (x) => (x.current.coverage.profitComplete = false),
    (x) =>
      (x.pro.products = Array.from({ length: 21 }, () => x.pro.products[0])),
    (x) => (x.current.trend = Array(367).fill(x.current.trend[0])),
    (x) => (x.current.coverage.productLimit = 100),
    (x) => (x.nextBoundaryAt = 'bad'),
  ]) {
    result = fixture()
    mutation(result)
    assert.equal(
      (await request(handler, 'GET', { range: 'month' })).statusCode,
      503
    )
  }
  result = fixture()
  result.current.revenueCents = null
  result.current.estimatedProfitCents = null
  result.current.coverage.profitComplete = false
  result.current.missingCostCount = 1
  r = await request(handler, 'GET', { range: 'month' })
  assert.equal(r.body.current.revenueCents, null)
  assert.equal(r.body.current.estimatedProfitCents, null)
  const { shopAnalysisBounds } = load('lib/shop-analysis.ts'),
    { shopBusinessDate } = load('lib/shop-costs.ts')
  assert.equal(shopBusinessDate(new Date('2026-03-08T04:59:00Z')), '2026-03-07')
  assert.equal(shopBusinessDate(new Date('2026-11-01T06:01:00Z')), '2026-11-01')
  assert.deepEqual(shopAnalysisBounds('week', '2026-03-08'), {
    start: '2026-03-02',
    end: '2026-03-09',
    previousStart: '2026-02-23',
    previousEnd: '2026-03-02',
  })
  assert.equal(shopAnalysisBounds('month', '2024-02-29').end, '2024-03-01')
  assert.equal(shopAnalysisBounds('year', '2024-02-29').end, '2025-01-01')
  console.log(
    'PASS B19 actual API/repository/projection: owner auth, tier/range transport, strict inputs, safe errors, NULL/overflow/bounds, private DTO and Toronto helper boundaries; no network.'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
