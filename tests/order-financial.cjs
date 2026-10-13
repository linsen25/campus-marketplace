const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const ref = 'pcaqxezdfxofysghssyo'
const user = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const empty = {
  paymentMethod: { status: 'unset', brand: null, last4: null },
  payoutAccount: { status: 'unset', institution: null, last4: null },
}
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

const handler = load(
  'pages/api/orders/[orderId]/simulate-payment-success.ts'
).default
const orderId = '33333333-3333-4333-8333-333333333333'
const action = '44444444-4444-4444-8444-444444444444'
function key(role = 'service_role', target = ref) {
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    'e30.' +
    Buffer.from(JSON.stringify({ role, ref: target })).toString('base64url') +
    '.test'
}
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
      query: { orderId },
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
      },
      body: {
        clientActionId: action,
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
;(async () => {
  for (const [environment, target] of [
    ['production', ref],
    ['production', 'yzvchumzyonegujucyqs'],
    ['staging', 'yzvchumzyonegujucyqs'],
    ['unknown', ref],
  ]) {
    config(environment, target)
    key()
    calls = []
    assert.equal((await invoke()).statusCode, 503)
    assert.equal(calls.length, 0)
  }
  config()
  key()
  identity = null
  assert.equal((await invoke()).statusCode, 401)
  identity = user
  assert.equal((await invoke({ method: 'GET' })).statusCode, 405)
  assert.equal(
    (
      await invoke({
        headers: {
          host: 'localhost:3000',
          origin: 'http://evil.invalid',
          'x-marketplace-request': '1',
        },
      })
    ).statusCode,
    403
  )
  assert.equal(
    (await invoke({ headers: { host: 'localhost:3000' } })).statusCode,
    403
  )
  for (const [role, target] of [
    ['anon', ref],
    ['service_role', 'yzvchumzyonegujucyqs'],
  ]) {
    key(role, target)
    calls = []
    assert.equal((await invoke()).statusCode, 503)
    assert.equal(calls.length, 0)
  }
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  assert.equal((await invoke()).statusCode, 503)
  key()
  for (const code of [
    'buyer_payment_method_not_ready',
    'order_not_payment_ready',
  ]) {
    data = { errorCode: code }
    calls = []
    const r = await invoke()
    assert.equal(r.statusCode, 409)
    assert.equal(r.data.code, code)
    assert.deepEqual(calls[0], {
      name: 'marketplace_simulate_order_payment_success',
      args: {
        p_order_id: orderId,
        p_buyer_id: user,
        p_client_action_id: action,
      },
    })
  }
  for (const code of ['42501', '23505', 'XX000']) {
    rpcError = { code, message: 'secret_provider_data' }
    const r = await invoke()
    assert.equal(
      r.statusCode,
      code === '42501' ? 403 : code === '23505' ? 409 : 503
    )
    assert(!JSON.stringify(r.data).includes('secret_provider_data'))
  }
  rpcError = null
  data = {
    serverTime: '2026-10-11T00:00:00Z',
    order: {
      id: orderId,
      buyer_id: user,
      seller_id: other,
      payment_status: 'paid',
      payment_paid_at: '2026-10-11T00:00:00Z',
      payout_status: 'not_eligible',
      fulfillment_status: 'awaiting_fulfillment',
      terms_snapshot: {
        protocol_version: 1,
        listing_media_snapshot: [],
        shipping_cost_mode: 'included',
      },
      provider_secret: 'never_forward',
      source: 'staging_simulator',
    },
  }
  const success = await invoke()
  assert.equal(success.statusCode, 200)
  assert.equal(success.data.order.paymentStatus, 'paid')
  assert.equal(success.data.order.payoutStatus, 'not_eligible')
  assert.equal(success.data.order.paymentPaidAt, data.order.payment_paid_at)
  assert(!JSON.stringify(success.data).includes('never_forward'))
  assert(!JSON.stringify(success.data).includes('staging_simulator'))
  data.order.buyer_id = other
  assert.equal((await invoke()).statusCode, 503)
  const sql = fs.readFileSync(
    'supabase/migrations/202610110002_order_financial_state.sql',
    'utf8'
  )
  assert(!/create table|drop table|provider_transaction/i.test(sql))
  assert(
    sql.includes("o.payment_status<>'paid' and o.reservation_expires_at<=t")
  )
  assert(
    sql.includes("old.payment_status='paid' or old.lifecycle_status<>'open'")
  )
  assert(
    sql.includes(
      'grant execute on function public.marketplace_simulate_order_payment_success(uuid,uuid,uuid) to service_role'
    )
  )
  assert(sql.includes("'source','staging_simulator'"))
  const transition = sql.slice(
    sql.indexOf(
      'create function public.marketplace_simulate_order_payment_success'
    )
  )
  assert(!transition.includes('require_seller_payout_ready'))
  assert(
    transition.indexOf('settle_listing_reservation') <
      transition.indexOf("payment_status='paid',payment_paid_at=t")
  )
  assert(
    transition.indexOf("if o.payment_status='paid'") <
      transition.indexOf("if method_status is distinct from 'set'")
  )
  const crypto = require('node:crypto')
  for (const [file, expected] of [
    [
      '202610100001_order_requests.sql',
      '5fae29019242fe24af2491805d06dd513051311e25811306387d7b0788dd775f',
    ],
    [
      '202610100002_order_accept.sql',
      'b1473cc9ac9330e535e6a9eaa8efebd2f66c895d904bb13e3429a862c0f47d02',
    ],
    [
      '202610110001_order_payout_gate.sql',
      '9d3c8894cfcbe9c0c8a9ad5daa33936c26c5eb3ec7d4e6f8bef64c201b997294',
    ],
  ])
    assert.equal(
      crypto
        .createHash('sha256')
        .update(fs.readFileSync('supabase/migrations/' + file))
        .digest('hex'),
      expected
    )
  console.log(
    'PASS Phase D static/immutable migrations, staging/ref/service guards before mutation, session/CSRF/method checks, identity injection ignored, domain errors, safe Paid/Payout DTO, no provider/provenance leak'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
