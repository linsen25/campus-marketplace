const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const ref = 'pcaqxezdfxofysghssyo'
const user = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
let identity = user,
  calls = [],
  rpcError = null,
  data = {}
const client = {
  auth: {
    getUser: async () => ({
      data: {
        user: identity
          ? {
              id: identity,
              email: 'test@uwo.ca',
              email_confirmed_at: '2026-01-01',
            }
          : null,
      },
      error: null,
    }),
  },
  rpc: async (name, args) => {
    calls.push({ name, args })
    return { data, error: rpcError }
  },
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => client }
      if (name === '@supabase/supabase-js')
        return { createClient: () => client }
      return name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)
    },
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
function config(env = 'staging', target = ref) {
  process.env.APP_ENV = env
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${target}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    'e30.' +
    Buffer.from(JSON.stringify({ role: 'anon', ref: target })).toString(
      'base64url'
    ) +
    '.test'
}

const handler = load('pages/api/orders/[[...segments]].ts').default
const orderId = '33333333-3333-4333-8333-333333333333'
const action = '44444444-4444-4444-8444-444444444444'
async function invoke(extra = {}) {
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
      this.data = v
      return this
    },
  }
  await handler(
    {
      method: 'POST',
      query: { segments: [orderId, 'cancel'] },
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
      },
      body: {
        clientActionId: action,
        reason: 'buyer_changed_mind',
        note: '',
        buyerId: other,
        paymentReady: true,
        paidAt: 'fake',
        payoutStatus: 'paid',
      },
      ...extra,
    },
    res
  )
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
  return res
}
(async () => {
  config()
  identity = null
  assert.equal((await invoke()).statusCode, 401)
  assert.equal(calls.length, 0)
  identity = user
  assert.equal(
    (
      await invoke({
        headers: { host: 'localhost:3000', origin: 'http://evil.test' },
      })
    ).statusCode,
    403
  )
  assert.equal(calls.length, 0)
  assert.equal((await invoke({ method: 'GET' })).statusCode, 405)
  data = { errorCode: 'order_not_cancellable' }
  assert.equal((await invoke()).statusCode, 409)
  assert.equal(calls.at(-1).name, 'marketplace_cancel_order')
  assert.deepEqual(Object.keys(calls.at(-1).args).sort(), [
    'p_client_action_id',
    'p_note',
    'p_order_id',
    'p_reason',
  ])
  for (const env of ['production', 'unknown']) {
    config(env)
    const count = calls.length
    assert.equal((await invoke()).statusCode, 503)
    assert.equal(calls.length, count)
  }
  const sql = fs.readFileSync(
    'supabase/migrations/202610110003_order_cancellation.sql',
    'utf8'
  )
  assert(!sql.includes('update public.order_requests'))
  assert(!sql.includes('insert into public.messages'))
  assert(
    sql.indexOf('from public.listings where id=o.listing_id for update') <
      sql.indexOf('where id=p_order_id for update')
  )
  assert(sql.includes('reserved_order_id=o.id'))
  assert(sql.includes("o.lifecycle_status='cancelled'"))
  console.log(
    'PASS cancellation API auth, CSRF, methods, stage-only guards, injected identity ignored, denial envelope, history/no-TEXT boundary and lock order'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
