// Actual owner API/repository/guards; offline transport only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
let actor = 'owner-a',
  email = 'b12@uwo.ca',
  confirmed = true,
  error = null
let invalid = false
const calls = []
const projection = {
  evaluatedAt: '2027-01-01T17:00:00Z',
  revision: 1,
  status: 'trial',
  reason: null,
  effectiveTier: 'pro',
  currentTermStart: '2027-01-01T17:00:00Z',
  currentTermEnd: '2027-03-01T17:00:00Z',
  graceEndsAt: '2027-03-06T17:00:00Z',
  nextBoundaryAt: '2027-03-01T17:00:00Z',
  trialClaimed: true,
  trialEligible: false,
  maxActiveProducts: 100,
  canOperateShop: true,
  canUseShopAnalytics: true,
  proPromotionEligible: true,
  accessCycleId: 'cycle-a',
  scheduledTier: null,
  scheduledAt: null,
  purchaseMode: null,
}
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: actor
          ? {
              id: actor,
              email,
              email_confirmed_at: confirmed ? '2026-01-01' : null,
            }
          : null,
      },
      error: null,
    }),
  },
  async rpc(name, value) {
    assert(
      ['marketplace_shop_membership', 'marketplace_claim_shop_trial'].includes(
        name
      )
    )
    calls.push({ actor, name, value })
    const p = invalid
      ? null
      : { ...projection, providerSecret: 'PRIVATE_DETAIL' }
    return {
      data:
        name === 'marketplace_shop_membership'
          ? p
          : { outcome: 'applied', membership: p },
      error,
    }
  },
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file)
  if (file === 'lib/supabase/server.ts')
    return { createMarketplaceClient: () => client }
  const module = { exports: {} }
  cache.set(file, module.exports)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', output)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    module,
    module.exports
  )
  cache.set(file, module.exports)
  return module.exports
}
const membership = load('pages/api/shop/membership.ts').default
const trialModule = load('pages/api/shop/trial.ts')
async function request(handler, method, body, query = {}, headers = {}) {
  const response = {
    code: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  await handler(
    {
      method,
      body,
      query,
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
        ...headers,
      },
    },
    response
  )
  return response
}
async function main() {
  const input = { actionId: '00000000-0000-4000-8000-000000000001' }
  let res = await request(membership, 'GET')
  assert.equal(res.code, 200)
  assert.deepEqual(res.body, projection)
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
  res = await request(trialModule.default, 'POST', input)
  assert.equal(res.code, 200)
  assert.deepEqual(res.body, projection)
  assert.deepEqual(calls.at(-1).value, { p_action_id: input.actionId })
  assert.equal(trialModule.config.api.bodyParser.sizeLimit, '1kb')
  for (const body of [
    null,
    [],
    {},
    { actionId: 5 },
    { actionId: 'invalid' },
    ...[
      'owner',
      'ownerId',
      'tier',
      'status',
      'expiresAt',
      'at',
      'proof',
      'amountCents',
    ].map((k) => ({ ...input, [k]: 'forged' })),
  ]) {
    const count = calls.length
    assert.equal((await request(trialModule.default, 'POST', body)).code, 400)
    assert.equal(calls.length, count, 'invalid request never reaches DB')
  }
  assert.equal(
    (await request(membership, 'GET', null, { owner: 'b' })).code,
    400
  )
  assert.equal(
    (await request(trialModule.default, 'POST', input, { now: 'future' })).code,
    400
  )
  for (const headers of [
    { origin: 'https://evil.example' },
    { 'x-marketplace-request': undefined },
  ])
    assert.equal(
      (await request(trialModule.default, 'POST', input, {}, headers)).code,
      403
    )
  actor = null
  assert.equal((await request(membership, 'GET')).code, 401)
  assert.equal((await request(trialModule.default, 'POST', input)).code, 401)
  actor = 'owner-b'
  confirmed = false
  assert.equal((await request(membership, 'GET')).code, 403)
  confirmed = true
  email = 'outsider@example.com'
  assert.equal((await request(trialModule.default, 'POST', input)).code, 403)
  email = 'b12@uwo.ca'
  await request(membership, 'GET')
  assert.equal(
    calls.at(-1).actor,
    'owner-b',
    'uses current session, never prior actor'
  )
  for (const [code, status] of [
    ['42501', 403],
    ['23505', 409],
    ['40001', 409],
    ['23514', 400],
    ['22P02', 400],
    ['08006', 503],
  ]) {
    error = { code, message: 'PRIVATE_DATABASE_DETAIL' }
    res = await request(trialModule.default, 'POST', input)
    assert.equal(res.code, status)
    assert(!JSON.stringify(res.body).includes('PRIVATE_'))
  }
  error = null
  invalid = true
  assert.equal((await request(membership, 'GET')).code, 503)
  assert.equal((await request(trialModule.default, 'POST', input)).code, 503)
  invalid = false
  assert.equal((await request(membership, 'POST', input)).code, 405)
  assert.equal((await request(trialModule.default, 'GET')).code, 405)
  const source = fs.readFileSync(
    'lib/server/shop-membership-repository.ts',
    'utf8'
  )
  assert(!source.includes('SERVICE_ROLE') && !source.includes('stripe'))
  console.log(
    'PASS B12 actual API/repository: fixed DTO, current Auth, strict inputs, same-origin, safe errors, no paid endpoint/provider'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
