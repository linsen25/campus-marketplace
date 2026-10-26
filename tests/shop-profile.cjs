// Owner API/repository with the real validators and same-origin guard. No network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const row = {
  id: 'shop-a',
  owner_id: 'owner-a',
  name: 'Vintage Loop',
  category: 'Electronics',
  description: 'New and pre-owned items.',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}
let saved = { ...row },
  actor = 'owner-a',
  fault = null,
  email = 'fixture@uwo.ca',
  confirmed = true,
  approved = false,
  loseCreateResponse = false,
  emptyCreateResponse = false
let beforeUpdate = null
const writes = []
const created = new Map(),
  rpcCalls = []
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: actor
          ? {
              id: actor,
              email,
              email_confirmed_at: confirmed ? '2026-10-01' : null,
            }
          : null,
      },
      error: null,
    }),
  },
  rpc(name, params) {
    assert.equal(name, 'marketplace_create_shop')
    assert.deepEqual(Object.keys(params), ['p_input'])
    rpcCalls.push({ name, params, actor })
    return {
      async single() {
        if (fault) return { data: null, error: fault }
        if (emptyCreateResponse) return { data: null, error: null }
        if (!approved)
          return {
            data: null,
            error: { code: '42501', message: 'PRIVATE_APPROVAL_REQUIRED' },
          }
        if (actor === saved.owner_id || created.has(actor))
          return {
            data: null,
            error: { code: '23505', message: 'PRIVATE_UNIQUE_DETAIL' },
          }
        const record = {
          id: 'new-' + actor,
          owner_id: actor,
          ...params.p_input,
          created_at: '2026-10-19T00:00:00Z',
          updated_at: '2026-10-19T00:00:00Z',
          isPro: true,
        }
        created.set(actor, record)
        if (loseCreateResponse) {
          loseCreateResponse = false
          return {
            data: null,
            error: { code: '08006', message: 'PRIVATE_TRANSPORT' },
          }
        }
        return { data: record, error: null }
      },
    }
  },
  from(table) {
    assert.equal(table, 'shops')
    let owner, patch
    const filters = {}
    return {
      select(selection) {
        assert.equal(
          selection,
          'id,owner_id,name,category,description,created_at,updated_at'
        )
        return this
      },
      eq(key, value) {
        assert(
          [
            'owner_id',
            'id',
            'updated_at',
            'name',
            'category',
            'description',
          ].includes(key)
        )
        filters[key] = value
        if (key === 'owner_id') owner = value
        return this
      },
      update(value) {
        patch = value
        return this
      },
      async maybeSingle() {
        if (fault) return { data: null, error: fault }
        if (patch && beforeUpdate) {
          const action = beforeUpdate
          beforeUpdate = null
          action()
        }
        let record = owner === saved.owner_id ? saved : created.get(owner)
        if (!record) return { data: null, error: null }
        if (
          !Object.entries(filters).every(
            ([key, value]) => record[key] === value
          )
        )
          return { data: null, error: null }
        if (patch) {
          writes.push(patch)
          record = { ...record, ...patch, updated_at: '2026-10-16T00:00:00Z' }
          if (owner === saved.owner_id) saved = record
          else created.set(owner, record)
        }
        return { data: { ...record }, error: null }
      },
    }
  },
}
const cache = {}
function load(file) {
  if (cache[file]) return cache[file].exports
  const m = { exports: {} }
  cache[file] = m
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText
  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      return name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)
    },
    m,
    m.exports
  )
  return m.exports
}
const handler = load('pages/api/shop.ts').default
async function request(method, body, query = {}, headers = {}) {
  const res = {
    code: 200,
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
      query,
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
        ...headers,
      },
    },
    res
  )
  return res
}
async function main() {
  let response = await request('GET')
  assert.deepEqual(response.body, {
    id: row.id,
    ownerId: row.owner_id,
    name: row.name,
    category: row.category,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  })
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
  for (const patch of [
    { name: '  Updated Shop  ' },
    { category: 'Collectibles' },
    { description: '  Updated description  ' },
  ]) {
    response = await request('PATCH', patch)
    assert.equal(response.code, 200)
    for (const [key, value] of Object.entries(patch))
      assert.equal(response.body[key], value.trim())
    assert.deepEqual(
      Object.keys(writes.at(-1)),
      Object.keys(patch),
      'partial update never sends stale unrelated fields'
    )
  }
  assert.equal(response.body.name, 'Updated Shop')
  // B13 optional condition: precision, stale/atomic conflicts and legacy compatibility.
  saved.updated_at = '2026-10-19T12:34:56.123456+00:00'
  response = await request('GET')
  const tag = response.headers.ETag
  assert.match(tag, /^"shop-[a-f0-9]{64}"$/)
  const base = { ...saved }
  response = await request(
    'PATCH',
    { name: 'Conditional owner' },
    {},
    { 'if-match': tag }
  )
  assert.equal(response.code, 200)
  assert.equal(response.body.name, 'Conditional owner')
  assert.equal(response.body.category, base.category)
  assert.equal(
    (await request('PATCH', { name: 'Stale' }, {}, { 'if-match': tag })).code,
    409
  )
  assert.equal(saved.name, 'Conditional owner')
  for (const invalid of [
    '',
    '*',
    'W/' + tag,
    'garbage',
    [tag],
    tag + ',' + tag,
  ])
    assert.equal(
      (
        await request(
          'PATCH',
          { name: 'Bad token' },
          {},
          { 'if-match': invalid }
        )
      ).code,
      400
    )
  const atomicTag = (await request('GET')).headers.ETag
  beforeUpdate = () => {
    saved = { ...saved, description: 'Competing committed update' }
  }
  assert.equal(
    (
      await request(
        'PATCH',
        { name: 'Racing write' },
        {},
        { 'if-match': atomicTag }
      )
    ).code,
    409,
    'UPDATE must include preimage even if timestamp collides'
  )
  assert.equal(saved.name, 'Conditional owner')
  assert.equal(saved.description, 'Competing committed update')
  response = await request('PATCH', { name: 'Legacy caller' })
  assert.equal(response.code, 200)
  assert.equal(response.body.name, 'Legacy caller')
  actor = 'owner-b'
  assert.equal(
    (await request('PATCH', { name: 'Other owner' }, {}, { 'if-match': tag }))
      .code,
    404
  )
  actor = 'owner-a'
  assert.equal((await request('GET')).body.updatedAt, saved.updated_at)
  console.log(
    'PASS B13 optional ETag precision, atomic preimage race, stale 409, malformed tokens, owner privacy and unconditional compatibility'
  )
  for (const patch of [
    null,
    [],
    {},
    { name: 42 },
    { name: '' },
    { name: ' ' },
    { name: 'n'.repeat(41) },
    { category: 'Furniture' },
    { description: '' },
    { description: 'd'.repeat(201) },
  ])
    assert.equal((await request('PATCH', patch)).code, 400)
  for (const key of [
    'id',
    'ownerId',
    'owner_id',
    'created_at',
    'updated_at',
    'username',
    'slug',
    'url',
    'isPro',
    'active',
    'status',
    'listing_channel',
  ])
    assert.equal((await request('PATCH', { [key]: 'forged' })).code, 400)
  const before = writes.length
  assert.equal(
    (
      await request(
        'PATCH',
        { name: 'Cross origin' },
        {},
        { origin: 'https://other.example' }
      )
    ).code,
    403
  )
  assert.equal(
    (
      await request(
        'PATCH',
        { name: 'Missing header' },
        {},
        { 'x-marketplace-request': undefined }
      )
    ).code,
    403
  )
  assert.equal(writes.length, before)
  actor = 'owner-b'
  response = await request('GET')
  assert.equal(response.code, 200)
  assert.equal(response.body, null)
  assert.equal((await request('PATCH', { name: 'Intruder' })).code, 404)
  assert.equal(writes.length, before)
  actor = null
  assert.equal((await request('GET')).code, 401)
  assert.equal((await request('PATCH', { name: 'Anonymous' })).code, 401)
  actor = 'owner-a'
  assert.equal(
    (await request('GET', undefined, { owner_id: 'owner-b' })).code,
    400
  )
  for (const method of ['DELETE', 'PUT']) {
    response = await request(method)
    assert.equal(response.code, 405)
    assert.equal(response.headers.Allow, 'GET, POST, PATCH')
  }
  for (const [code, status] of [
    ['42501', 403],
    ['23514', 400],
    ['XX000', 503],
  ]) {
    fault = { code, message: 'PRIVATE_DATABASE_DIAGNOSTIC' }
    response = await request('GET')
    assert.equal(response.code, status)
    assert(
      !JSON.stringify(response.body).includes('PRIVATE_DATABASE_DIAGNOSTIC')
    )
  }
  fault = null
  const repo = load(
    'lib/server/shop-profile-repository.ts'
  ).createShopProfileRepository({})
  assert.deepEqual(Object.keys(repo).sort(), [
    'createOwnShop',
    'getOwnShop',
    'updateOwnShop',
  ])
  assert(!('isPro' in (await repo.getOwnShop())))
  console.log(
    'PASS Shop owner mapping, GET existing/null, partial PATCH/trim/shared validation, field whitelist, authentication/ownership, same-origin, sanitized errors, no delete/entitlement'
  )
  const valid = {
    name: ' \tNew Shop\u00a0',
    category: 'Electronics',
    description: '\ufeffA real description\n',
  }
  const existingBefore = { ...saved }
  approved = true
  assert.equal((await request('POST', valid)).code, 409)
  assert.deepEqual(saved, existingBefore)
  actor = 'owner-b'
  const initialCalls = rpcCalls.length
  for (const value of [
    null,
    [],
    {},
    'bad',
    { name: 'N' },
    { ...valid, description: undefined },
    { ...valid, name: 1 },
    { ...valid, name: ' ' },
    { ...valid, description: null },
    { ...valid, category: ' Electronics ' },
    { ...valid, category: 'Furniture' },
    { ...valid, name: '😀'.repeat(21) },
    { ...valid, description: 'x'.repeat(201) },
  ]) {
    assert.equal((await request('POST', value)).code, 400)
  }
  for (const key of [
    'id',
    'ownerId',
    'owner_id',
    'username',
    'shopId',
    'profile',
    'isPro',
    'tier',
    'status',
    'active',
    'trialEligibility',
    'expiresAt',
    'published_at',
    'priority',
    'revenue',
    'productQuota',
    'created_at',
    'updated_at',
  ])
    assert.equal(
      (await request('POST', { ...valid, [key]: 'forged' })).code,
      400
    )
  assert.equal(rpcCalls.length, initialCalls, 'invalid inputs do not call RPC')
  assert.equal(
    (await request('POST', valid, { owner_id: 'owner-a' })).code,
    400
  )
  assert.equal(
    (await request('POST', valid, {}, { origin: 'https://other.example' }))
      .code,
    403
  )
  assert.equal(
    (await request('POST', valid, {}, { 'x-marketplace-request': undefined }))
      .code,
    403
  )
  actor = null
  assert.equal((await request('POST', valid)).code, 401)
  actor = 'owner-b'
  approved = false
  confirmed = false
  assert.equal((await request('POST', valid)).code, 403)
  confirmed = true
  email = 'outside@example.com'
  assert.equal((await request('POST', valid)).code, 403)
  // A confirmed ordinary email is still blocked until the authoritative
  // Shop application is approved; the old fixture incorrectly used UWO
  // email as a proxy for approval.
  approved = true
  assert.equal(
    rpcCalls.length,
    initialCalls + 1,
    'confirmed-but-unapproved attempt reaches the authoritative approval RPC'
  )
  response = await request('POST', valid)
  assert.equal(response.code, 201)
  assert.equal(response.body.name, 'New Shop')
  assert.equal(response.body.description, 'A real description')
  assert.equal(response.body.ownerId, 'owner-b')
  assert.deepEqual(
    Object.keys(response.body).sort(),
    [
      'id',
      'ownerId',
      'name',
      'category',
      'description',
      'createdAt',
      'updatedAt',
    ].sort()
  )
  assert.deepEqual(rpcCalls.at(-1).params, {
    p_input: {
      name: 'New Shop',
      category: 'Electronics',
      description: 'A real description',
    },
  })
  const first = response.body
  assert.deepEqual((await request('GET')).body, first)
  response = await request('POST', { ...valid, name: 'Overwrite' })
  assert.equal(response.code, 409)
  assert.equal(response.body.error, 'Shop already exists.')
  assert.deepEqual((await request('GET')).body, first)
  assert.equal((await request('PATCH', { name: 'New name' })).code, 200)
  assert.equal((await request('GET')).body.name, 'New name')
  actor = 'owner-c'
  assert.equal((await request('GET')).body, null)
  loseCreateResponse = true
  assert.equal((await request('POST', valid)).code, 503)
  assert.equal((await request('POST', valid)).code, 409)
  assert.equal(
    (await request('GET')).body.ownerId,
    'owner-c',
    'lost response recovered via GET'
  )
  actor = 'owner-d'
  emptyCreateResponse = true
  assert.equal((await request('POST', valid)).code, 503)
  emptyCreateResponse = false
  for (const [code, status] of [
    ['42501', 403],
    ['23505', 409],
    ['23514', 400],
    ['XX000', 503],
    ['PGRST202', 503],
  ]) {
    fault = { code, message: 'PRIVATE_DATABASE_DIAGNOSTIC' }
    response = await request('POST', valid)
    assert.equal(response.code, status)
    assert(
      !JSON.stringify(response.body).includes('PRIVATE_DATABASE_DIAGNOSTIC')
    )
  }
  fault = null
  assert.deepEqual(
    saved,
    existingBefore,
    'all new provisioning leaves original Shop untouched'
  )
  assert.equal(load('pages/api/shop.ts').config.api.bodyParser.sizeLimit, '4kb')
  console.log(
    'PASS B11 actual owner POST API/repository: 201/400/401/403/409/503, exact fields, forgery/CSRF/auth, GET/PATCH, response-loss retry, safe DTO, no privileged insert or network; native database required separately'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
