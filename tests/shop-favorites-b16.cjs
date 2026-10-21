// Actual repository, route and shared client cache; controlled transport, no network.
const fs = require('fs'),
  path = require('path'),
  ts = require('typescript'),
  assert = require('assert/strict')
const id = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222'
const shop = {
  id,
  sellerProfileId: other,
  username: 'local_shop',
  shopName: 'Local Shop',
  category: 'Electronics',
  description: 'Public',
  badgeTier: 'plus',
  email: 'must not escape',
  billing: 'private',
}
let actor = 'a',
  rpcError = null,
  calls = []
const saved = new Map()
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: actor
          ? { id: actor, email: 'local@uwo.ca', email_confirmed_at: 'yes' }
          : null,
      },
      error: null,
    }),
  },
  rpc: async (name, args) => {
    calls.push({ name, args, actor })
    if (rpcError) return { data: null, error: rpcError }
    const set = saved.get(actor) || new Set()
    saved.set(actor, set)
    if (name === 'marketplace_set_shop_favorite') {
      if (args.p_enabled) set.add(args.p_shop_id)
      else set.delete(args.p_shop_id)
      return {
        data: { shopId: args.p_shop_id, favorited: args.p_enabled },
        error: null,
      }
    }
    if (name === 'marketplace_shop_favorite_states')
      return {
        data: { favoriteShopIds: args.p_shop_ids.filter((x) => set.has(x)) },
        error: null,
      }
    return {
      data: {
        shops: set.has(id) ? [shop] : [],
        page: args.p_query.page,
        hasNextPage: false,
        refreshAfterMs: 30000,
      },
      error: null,
    }
  },
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full).exports
  const module = { exports: {} }
  cache.set(full, module)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, jsx: 4, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (name === '@/components/auth/auth-modal')
        return { useAuthModal: () => ({}) }
      if (name === '@/components/listings/marketplace-session')
        return { useMarketplaceSession: () => ({}) }
      if (name.startsWith('@/') || name.startsWith('.')) {
        let f = name.startsWith('@/')
          ? path.resolve(name.slice(2))
          : path.resolve(path.dirname(full), name)
        if (!path.extname(f)) f += '.ts'
        return load(f)
      }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}
const handler = load('pages/api/shop-favorites/[[...segments]].ts').default
async function request(
  method,
  query = {},
  body,
  origin = 'http://localhost:3000'
) {
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
    json(v) {
      this.body = v
      return this
    },
  }
  await handler(
    {
      method,
      query,
      body,
      headers: { host: 'localhost:3000', origin, 'x-marketplace-request': '1' },
    },
    res
  )
  assert.match(res.headers['Cache-Control'], /no-store/)
  return res
}
async function main() {
  assert.equal((await request('POST', { segments: [id] })).body.favorited, true)
  assert.equal((await request('POST', { segments: [id] })).body.favorited, true)
  const list = await request('GET', { page: '1', pageSize: '20' })
  assert.equal(list.statusCode, 200)
  assert.equal(list.body.shops[0].id, id)
  assert(!('email' in list.body.shops[0]))
  assert(!('billing' in list.body.shops[0]))
  assert.deepEqual(
    (await request('GET', { ids: id + ',' + other })).body.favoriteShopIds,
    [id]
  )
  actor = 'b'
  assert.deepEqual((await request('GET', {})).body.shops, [])
  await request('DELETE', { segments: [id] })
  actor = 'a'
  assert.deepEqual((await request('GET', { ids: id })).body.favoriteShopIds, [
    id,
  ])
  for (const query of [
    { ids: id, page: '1' },
    { ids: [id] },
    { page: ['1', '2'] },
    { page: '0' },
    { pageSize: '101' },
    { user_id: 'b' },
    { ids: 'bad' },
  ])
    assert.equal((await request('GET', query)).statusCode, 400)
  assert.equal(
    (await request('POST', { segments: [id] }, { userId: 'b' })).statusCode,
    400
  )
  assert.equal((await request('POST', { segments: ['bad'] })).statusCode, 400)
  assert.equal(
    (
      await request(
        'POST',
        { segments: [id] },
        undefined,
        'http://evil.invalid'
      )
    ).statusCode,
    403
  )
  assert.equal((await request('PATCH', { segments: [id] })).statusCode, 405)
  actor = null
  assert.equal((await request('GET', {})).statusCode, 401)
  assert.equal((await request('POST', { segments: [id] })).statusCode, 401)
  actor = 'a'
  rpcError = { code: 'P0002', message: 'private provider error' }
  assert.equal((await request('POST', { segments: [id] })).statusCode, 404)
  rpcError = { code: 'XX999', message: 'private secret' }
  const failed = await request('GET', {})
  assert.equal(failed.statusCode, 503)
  assert(!JSON.stringify(failed.body).includes('private'))
  rpcError = null
  assert(
    calls.every((c) => !Object.keys(c.args).some((k) => /user|actor/.test(k)))
  )
  await request('DELETE', { segments: [id] })
  await request('DELETE', { segments: [id] })
  assert.deepEqual((await request('GET', { ids: id })).body.favoriteShopIds, [])

  const { createShopFavoritesCache } = load('hooks/use-shop-favorites.ts')
  const resource = createShopFavoritesCache()
  let clientActor = 'a',
    writes = 0,
    reads = 0,
    mode = '',
    release
  const rows = { a: new Set(), b: new Set() }
  const tick = () => new Promise((r) => setImmediate(r))
  global.fetch = async (url, options) => {
    assert(String(url).startsWith('/api/shop-favorites'))
    const u = new URL(url, 'http://localhost')
    if (options.method === 'GET') {
      reads++
      if (mode === 'unreadable') throw Error('offline')
      return new Response(
        JSON.stringify({
          favoriteShopIds: (u.searchParams.get('ids') || '')
            .split(',')
            .filter((x) => rows[clientActor].has(x)),
        }),
        { status: 200 }
      )
    }
    writes++
    const who = clientActor,
      enabled = options.method === 'POST'
    if (mode === 'delay')
      await new Promise((r) => {
        release = r
      })
    if (mode !== 'fail' && mode !== 'unreadable') {
      if (enabled) rows[who].add(id)
      else rows[who].delete(id)
    }
    if (['lost', 'fail', 'unreadable'].includes(mode))
      throw Error('controlled failure')
    return new Response(JSON.stringify({ shopId: id, favorited: enabled }), {
      status: 200,
    })
  }
  resource.bind('a')
  resource.load(id)
  resource.load(other)
  await tick()
  assert.equal(reads, 1, 'batch displayed hearts')
  assert.equal(resource.state(id).liked, false)
  mode = 'delay'
  const one = resource.change(id, true)
  await resource.change(id, true)
  assert.equal(writes, 1, 'one shared mutation')
  assert.equal(resource.state(id).liked, false, 'no optimistic success')
  assert.equal(resource.state(id).pending, true)
  release()
  await one
  assert.equal(resource.state(id).liked, true)
  mode = 'fail'
  await resource.change(id, false)
  assert.equal(resource.state(id).liked, true)
  assert(resource.state(id).error)
  mode = 'lost'
  await resource.change(id, false)
  assert.equal(
    resource.state(id).liked,
    false,
    'committed lost response recovered by read'
  )
  assert.equal(resource.state(id).error, '')
  mode = 'unreadable'
  await resource.change(id, true)
  assert.equal(resource.state(id).uncertain, true)
  const prior = writes
  await resource.change(id, true)
  assert.equal(writes, prior, 'must reconcile before retry')
  mode = ''
  resource.load(id, true)
  await tick()
  assert.equal(resource.state(id).uncertain, false)
  mode = 'delay'
  const stale = resource.change(id, true)
  resource.bind('b')
  clientActor = 'b'
  release()
  await stale
  assert.equal(resource.state(id), undefined, 'old account response discarded')
  mode = ''
  resource.load(id)
  await tick()
  assert.equal(resource.state(id).liked, false)
  resource.bind('')
  assert.equal(resource.state(id), undefined)
  console.log(
    'PASS B16 actual API/repository: auth, origin, bounds, whitelist, idempotent intent; shared cache batching, pending, failed/ambiguous saves, reload and account isolation'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
