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
const service = load('lib/server/orders-service.ts'),
  handler = load('pages/api/orders/[[...segments]].ts').default
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
  for (const [environment, target] of [
    ['production', 'yzvchumzyonegujucyqs'],
    ['staging', 'yzvchumzyonegujucyqs'],
    ['production', ref],
    ['unknown', ref],
  ]) {
    config(environment, target)
    const before = calls
    assert.equal((await invoke({})).statusCode, 503)
    assert.equal(calls, before)
  }
  config('staging')
  assert.equal(
    (await invoke({ query: { workspace: 'purchases' } })).statusCode,
    401
  )
  const id = '11111111-1111-4111-8111-111111111111'
  for (const [area, action] of [
    ['inspection', 'confirm'],
    ['payment', 'start'],
  ]) {
    const p = [id, area, action]
    assert.equal(
      (await invoke({ query: { segments: p }, method: 'GET' })).statusCode,
      405
    )
    assert.equal(
      (
        await invoke({
          query: { segments: p },
          method: 'POST',
          body: { clientActionId: id },
        })
      ).statusCode,
      403
    )
    for (const field of [
      'amount',
      'total',
      'paymentStatus',
      'paidAt',
      'success',
      'buyerId',
      'sellerId',
      'fee',
      'outcome',
    ]) {
      const before = calls
      await assert.rejects(() =>
        service
          .createOrdersService({
            req: { headers: {} },
            res: { setHeader() {}, getHeader() {} },
          })
          .campusAction(id, area, { clientActionId: id, [field]: 'forged' })
      )
      assert.equal(calls, before)
    }
  }
  for (const action of ['confirm', 'decline', 'withdraw']) {
    const p = [id, 'meetup', 'proposals', id, action]
    assert.equal(
      (await invoke({ query: { segments: p }, method: 'GET' })).statusCode,
      405
    )
    assert.equal(
      (await invoke({ query: { segments: p }, method: 'POST', body: {} }))
        .statusCode,
      403
    )
  }
  for (const bad of [
    'itemPrice',
    'fulfillment',
    'buyerId',
    'sellerId',
    'status',
    'graceMinutes',
    'serverTime',
  ]) {
    const before = calls
    const c = service.createOrdersService({
      req: { headers: {} },
      res: { setHeader() {}, getHeader() {} },
    })
    await assert.rejects(() =>
      c.meetupAction(id, 'propose', null, {
        location: 'Library',
        scheduledAt: '2026-10-13T12:00:00Z',
        note: '',
        clientActionId: id,
        [bad]: 'bad',
      })
    )
    assert.equal(calls, before)
  }
  assert.equal(
    (
      await invoke({
        query: { segments: [id, 'meetup', 'proposals', id, 'unknown'] },
        method: 'POST',
      })
    ).statusCode,
    404
  )
  console.log(
    'PASS D2A body/payment authority boundaries plus D1 route/method/CSRF/session/project guards and rejection of cross-scope economic/clock/role fields'
  )
}
main().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
