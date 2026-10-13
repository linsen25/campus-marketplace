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
const service = load('lib/server/order-request-service.ts'),
  handler = load('pages/api/order-requests/[[...segments]].ts').default
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
  config('staging')
  assert.equal(service.requireOrderRequestEnvironment(), undefined)
  for (const [env, target] of [
    ['production', 'yzvchumzyonegujucyqs'],
    ['staging', 'yzvchumzyonegujucyqs'],
    ['production', ref],
    ['unknown', ref],
  ]) {
    config(env, target)
    assert.throws(() => service.requireOrderRequestEnvironment())
    const before = calls
    assert.equal((await invoke({})).statusCode, 503)
    assert.equal(calls, before)
  }
  config('staging')
  assert.equal(
    (await invoke({ query: { segments: ['bad', 'accept'] } })).statusCode,
    405
  )
  assert.equal((await invoke({ method: 'PATCH' })).statusCode, 405)
  assert.equal(
    (await invoke({ method: 'POST', headers: { host: 'localhost:3000' } }))
      .statusCode,
    403
  )
  assert.equal(
    (
      await invoke({
        method: 'POST',
        headers: {
          host: 'localhost:3000',
          origin: 'http://localhost:3112',
          'x-marketplace-request': '1',
        },
      })
    ).statusCode,
    403
  )
  const result = await invoke({})
  assert.equal(result.statusCode, 401)
  const accept = await invoke({
    method: 'POST',
    query: { segments: ['11111111-1111-4111-8111-111111111111', 'accept'] },
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'x-marketplace-request': '1',
    },
    body: {
      clientActionId: '22222222-2222-4222-8222-222222222222',
      buyerId: 'forged',
      reservationExpiresAt: 'forged',
    },
  })
  assert.equal(accept.statusCode, 401)
  for (const key of [
    'protocolVersion',
    'protocol_version',
    'senderId',
    'sender_user_id',
    'recipientId',
    'recipient_user_id',
  ]) {
    const before = calls
    const forged = await invoke({
      method: 'POST',
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
      },
      body: { [key]: 'forged' },
    })
    assert.equal(forged.statusCode, 400)
    assert.equal(calls, before, 'Forged identity rejected before any RPC')
  }
  assert.throws(() => service.mapRequest({ protocol_version: 2 }))
  console.log(
    'PASS Request API: staging-only/project binding before network; Accept POST boundary; CSRF/methods/unauthenticated checks.'
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
