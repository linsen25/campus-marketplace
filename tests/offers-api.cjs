const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
const service = load('lib/server/offers-service.ts'),
  handler = load('pages/api/offers/[[...segments]].ts').default
const ref = 'pcaqxezdfxofysghssyo'
function config(environment, target = ref) {
  process.env.APP_ENV = environment
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${target}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY =
    'e30.' +
    Buffer.from(JSON.stringify({ role: 'anon', ref: target })).toString(
      'base64url'
    ) +
    '.x'
}
let calls = 0
global.fetch = async () => {
  calls++
  return new Response(JSON.stringify({ message: 'no session' }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  })
}
async function invoke(req) {
  const headers = {},
    res = {
      statusCode: 200,
      setHeader: (k, v) => (headers[k] = v),
      getHeader: (k) => headers[k],
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
      method: 'GET',
      query: { conversationId: '11111111-1111-4111-8111-111111111111' },
      headers: { host: 'localhost:3000' },
      ...req,
    },
    res
  )
  return res
}
async function main() {
  for (const [env, target] of [
    ['production', 'yzvchumzyonegujucyqs'],
    ['staging', 'yzvchumzyonegujucyqs'],
    ['production', ref],
    ['unknown', ref],
  ]) {
    config(env, target)
    const before = calls
    assert.equal((await invoke({})).statusCode, 503)
    assert.equal(calls, before)
  }
  config('staging')
  assert.equal((await invoke({})).statusCode, 401)
  assert.equal(
    (
      await invoke({
        method: 'POST',
        query: { segments: ['id', 'accept'] },
        body: {},
      })
    ).statusCode,
    403
  )
  assert.equal((await invoke({ method: 'PATCH' })).statusCode, 405)
  assert.equal((await invoke({ method: 'POST', body: {} })).statusCode, 403)
  for (const key of [
    'senderId',
    'recipientId',
    'protocolVersion',
    'status',
    'listingId',
    'buyerId',
    'sellerId',
    'senderRole',
  ]) {
    const before = calls
    assert.equal(
      (
        await invoke({
          method: 'POST',
          headers: {
            host: 'localhost:3000',
            origin: 'http://localhost:3000',
            'x-marketplace-request': '1',
          },
          body: { [key]: 'forged' },
        })
      ).statusCode,
      400
    )
    assert.equal(calls, before)
  }
  const row = {
    protocol_version: 2,
    status: 'active',
    currency: 'CAD',
    item_amount_cents: 7000,
    sender_user_id: 'buyer',
    recipient_user_id: 'seller',
    seller_note: 'Offer terms',
    offer_terms: {
      item_amount_cents: 7000,
      fulfillment: 'delivery',
      delivery_fee_cents: 1000,
      delivery_method: 'courier',
      note: 'Offer terms',
    },
  }
  assert.equal(service.mapOffer(row, 'buyer').canWithdraw, true)
  assert.equal(service.mapOffer(row, 'seller').canWithdraw, false)
  assert.equal(
    service.mapOffer({ ...row, status: 'superseded' }, 'buyer').status,
    'Replaced'
  )
  assert.equal(
    service.mapOffer({ ...row, status: 'withdrawn' }, 'buyer').canWithdraw,
    false
  )
  assert.throws(() =>
    service.mapOffer({ ...row, protocol_version: 1 }, 'buyer')
  )
  const dto = service.mapOffer(
    { ...row, private_financial_token: 'private' },
    'buyer'
  )
  assert(!('private_financial_token' in dto))
  assert.equal(dto.canAccept, false)
  assert.equal(
    service.mapOffer({ ...row, accept_block_reason: null }, 'seller').canAccept,
    true
  )
  assert.equal(
    service.mapOffer(
      { ...row, accept_block_reason: 'listing_changed' },
      'seller'
    ).canAccept,
    false
  )
  assert.equal(dto.linkedOrderId, null)
  console.log(
    'PASS V2 Offer API environment/CSRF/Accept recipient eligibility/forgery/unauthenticated/safe DTO/action eligibility'
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
