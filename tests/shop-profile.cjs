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
  fault = null
const writes = []
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: actor
          ? {
              id: actor,
              email: 'fixture@uwo.ca',
              email_confirmed_at: '2026-10-01',
            }
          : null,
      },
      error: null,
    }),
  },
  from(table) {
    assert.equal(table, 'shops')
    let owner, patch
    return {
      select(selection) {
        assert.equal(
          selection,
          'id,owner_id,name,category,description,created_at,updated_at'
        )
        return this
      },
      eq(key, value) {
        assert.equal(key, 'owner_id')
        owner = value
        return this
      },
      update(value) {
        patch = value
        return this
      },
      async maybeSingle() {
        if (fault) return { data: null, error: fault }
        if (owner !== saved.owner_id) return { data: null, error: null }
        if (patch) {
          writes.push(patch)
          saved = { ...saved, ...patch, updated_at: '2026-10-16T00:00:00Z' }
        }
        return { data: { ...saved }, error: null }
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
  for (const method of ['POST', 'DELETE', 'PUT']) {
    response = await request(method)
    assert.equal(response.code, 405)
    assert.equal(response.headers.Allow, 'GET, PATCH')
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
  assert.deepEqual(Object.keys(repo).sort(), ['getOwnShop', 'updateOwnShop'])
  assert(!('isPro' in (await repo.getOwnShop())))
  console.log(
    'PASS Shop owner mapping, GET existing/null, partial PATCH/trim/shared validation, field whitelist, authentication/ownership, same-origin, sanitized errors, no create/delete/entitlement'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
