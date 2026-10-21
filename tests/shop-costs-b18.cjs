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
const cost = load('pages/api/shop/costs.ts').default,
  expenses = load('pages/api/shop/expenses/[[...segments]].ts').default
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
const fields = {
  amountCents: 125,
  currency: 'CAD',
  on: '2024-02-29',
  kind: 'Packaging',
  description: 'Boxes',
}
const record = {
  ...fields,
  id,
  shopId,
  revision: 1,
  createdAt: '2026-10-19',
  updatedAt: '2026-10-19',
  deletedAt: null,
  owner_origin_id: 'SECRET_OWNER',
  create_hash: 'SECRET_HASH',
}
async function main() {
  result = {
    listingId: id,
    shopId,
    amountCents: null,
    currency: 'CAD',
    revision: 0,
    updatedAt: null,
    owner: 'SECRET_OWNER',
  }
  let r = await request(cost, 'GET', { listingId: id })
  assert.equal(r.statusCode, 200)
  assert.equal(r.body.amountCents, null)
  assert(!('owner' in r.body))
  for (const amountCents of [null, 0, Number.MAX_SAFE_INTEGER]) {
    result = { ...result, amountCents }
    r = await request(
      cost,
      'PATCH',
      { listingId: id },
      { amountCents, currency: 'CAD', revision: 0 }
    )
    assert.equal(r.statusCode, 200)
    assert.equal(calls.at(-1).args.p_change.amountCents, amountCents)
  }
  for (const patch of [
    { amountCents: -1 },
    { amountCents: 1.1 },
    { amountCents: '1' },
    { amountCents: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'USD' },
    { revision: -1 },
    { revision: '0' },
    { owner: 'other' },
  ]) {
    assert.equal(
      (
        await request(
          cost,
          'PATCH',
          { listingId: id },
          { amountCents: 0, currency: 'CAD', revision: 0, ...patch }
        )
      ).statusCode,
      400
    )
  }
  for (const query of [
    {},
    { listingId: 'bad' },
    { listingId: [id] },
    { listingId: id, owner: 'other' },
  ])
    assert.equal((await request(cost, 'GET', query)).statusCode, 400)
  assert.equal(
    (await request(cost, 'POST', { listingId: id }, {})).statusCode,
    405
  )
  assert.equal(
    (
      await request(
        cost,
        'PATCH',
        { listingId: id },
        {},
        { origin: 'https://attacker.invalid' }
      )
    ).statusCode,
    403
  )
  assert.equal(
    (
      await request(
        cost,
        'PATCH',
        { listingId: id },
        {},
        { 'x-marketplace-request': '' }
      )
    ).statusCode,
    403
  )
  actor = null
  assert.equal((await request(cost, 'GET', { listingId: id })).statusCode, 401)
  actor = 'owner'
  verified = false
  assert.equal((await request(cost, 'GET', { listingId: id })).statusCode, 403)
  verified = true
  for (const [code, status] of [
    ['42501', 404],
    ['40001', 409],
    ['23505', 409],
    ['22003', 400],
    ['22008', 400],
    ['unexpected', 503],
  ]) {
    rpcError = { code, message: 'SECRET_DATABASE_DETAIL' }
    r = await request(cost, 'GET', { listingId: id })
    assert.equal(r.statusCode, status)
    assert(!JSON.stringify(r.body).includes('SECRET'))
    rpcError = null
  }
  result = record
  r = await request(expenses, 'POST', {}, { id, ...fields })
  assert.equal(r.statusCode, 201)
  assert(!JSON.stringify(r.body).includes('SECRET'))
  assert.equal(calls.at(-1).args.p_action, 'create')
  r = await request(
    expenses,
    'PATCH',
    { segments: [id] },
    { id, ...fields, revision: 1 }
  )
  assert.equal(r.statusCode, 200)
  assert.equal(calls.at(-1).args.p_action, 'update')
  result = { ...record, deletedAt: '2026-10-19', revision: 2 }
  r = await request(expenses, 'DELETE', { segments: [id] }, { id, revision: 1 })
  assert.equal(r.body.deletedAt, '2026-10-19')
  assert.equal(calls.at(-1).args.p_action, 'delete')
  result = { expenses: [record], shopId, nextCursor: id }
  r = await request(expenses, 'GET', { beforeId: id })
  assert.equal(r.body.expenses.length, 1)
  assert(!JSON.stringify(r.body).includes('SECRET'))
  assert.equal(calls.at(-1).args.p_input.beforeId, id)
  for (const patch of [
    { amountCents: 0 },
    { kind: ['Packaging'] },
    { kind: 'Travel' },
    { on: '2025-02-29' },
    { on: '0000-01-01' },
    { on: '9999-01-01' },
    { description: 'x'.repeat(501) },
    { owner: 'other' },
    { currency: 'USD' },
  ])
    assert.equal(
      (await request(expenses, 'POST', {}, { id, ...fields, ...patch }))
        .statusCode,
      400
    )
  assert.equal(
    (
      await request(
        expenses,
        'PATCH',
        { segments: [shopId] },
        { id, ...fields, revision: 1 }
      )
    ).statusCode,
    400
  )
  assert.equal(
    (await request(expenses, 'DELETE', { segments: [id] }, { id, revision: 0 }))
      .statusCode,
    400
  )
  for (const query of [
    { beforeId: ['bad'] },
    { segments: [id, id] },
    { segments: 'bad' },
    { owner: 'other' },
  ])
    assert.equal((await request(expenses, 'GET', query)).statusCode, 400)
  assert.equal(
    (await request(expenses, 'POST', { beforeId: id }, { id, ...fields }))
      .statusCode,
    400
  )
  assert.equal(
    (await request(expenses, 'GET', { segments: [id] })).statusCode,
    405
  )
  assert.equal(
    (
      await request(
        expenses,
        'POST',
        {},
        { id, ...fields },
        { origin: 'https://attacker.invalid' }
      )
    ).statusCode,
    403
  )
  actor = null
  assert.equal((await request(expenses, 'GET', {})).statusCode, 401)
  actor = 'owner'
  rpcError = { code: '42501' }
  assert.equal((await request(expenses, 'GET', {})).statusCode, 404)
  rpcError = null
  const money = load('lib/shop-costs.ts'),
    { parseOfferAmount } = load('lib/offer-amount.ts')
  assert.equal(
    money.costInputText(Number.MAX_SAFE_INTEGER),
    '90071992547409.91'
  )
  assert.equal(
    parseOfferAmount(money.costInputText(Number.MAX_SAFE_INTEGER)),
    Number.MAX_SAFE_INTEGER
  )
  assert.equal(money.privateCostMoney(null), 'Unknown')
  assert.equal(money.privateCostMoney(0), 'CA$0.00')
  assert.equal(
    money.shopBusinessDate(new Date('2026-03-08T04:59:00Z')),
    '2026-03-07'
  )
  assert.equal(
    money.shopBusinessDate(new Date('2026-03-08T07:01:00Z')),
    '2026-03-08'
  )
  assert.equal(money.validExpenseDate('2024-02-29', '2024-03-01'), true)
  assert.equal(money.validExpenseDate('2025-02-29', '2025-03-01'), false)
  console.log(
    'PASS B18 actual API/repository: verified owner auth, same-origin, strict inputs, cents/null/zero, Toronto dates, explicit private DTOs, sanitized failures and conflict/delete transport. Persistence/races exercised by native PostgreSQL suites.'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
