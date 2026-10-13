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
  data = empty
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
const service = load('lib/server/financial-capabilities-service.ts')
const handler = load('pages/api/financial-capabilities.ts').default
const testHandler = load(
  'pages/api/financial-capabilities/test-state.ts'
).default
async function testInvoke(request = {}) {
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
  await testHandler(
    {
      method: 'POST',
      query: {},
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
      },
      body: { capability: 'payment_method', status: 'set' },
      ...request,
    },
    res
  )
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
  return res
}
async function invoke(request = {}) {
  const res = {
    headers: {},
    statusCode: 200,
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
      method: 'GET',
      query: {},
      headers: { host: 'localhost:3000' },
      ...request,
    },
    res
  )
  assert.equal(res.headers['Cache-Control'], 'private, no-store')
  return res
}
;(async () => {
  config()
  assert.deepEqual((await invoke()).data, empty)
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    'e30.' +
    Buffer.from(JSON.stringify({ role: 'service_role', ref })).toString(
      'base64url'
    ) +
    '.test'
  for (const request of [
    { query: { userId: other } },
    {
      body: {
        capability: 'payment_method',
        status: 'set',
        userId: other,
        providerOwnerRef: 'ATTACKER',
        providerInstrumentRef: 'ATTACKER',
      },
    },
    { body: { capability: 'payout_account', status: 'ready', userId: other } },
  ]) {
    calls = []
    assert.equal((await testInvoke(request)).statusCode, 200)
    const mutation = calls.find(
      (x) => x.name === 'marketplace_record_financial_capability'
    ).args
    assert.equal(mutation.p_user_id, user)
    assert.equal(mutation.p_provider_key, 'staging_test')
    assert(!JSON.stringify(mutation).includes('ATTACKER'))
    assert(!JSON.stringify(mutation).includes(other))
  }
  for (const [capability, status] of [
    ['payment_method', 'ready'],
    ['payout_account', 'set'],
    ['bogus', 'set'],
    ['payout_account', 'bogus'],
  ]) {
    calls = []
    assert.equal(
      (await testInvoke({ body: { capability, status } })).statusCode,
      400
    )
    assert.equal(calls.length, 0)
  }
  assert.equal(
    (
      await testInvoke({
        headers: {
          host: 'localhost:3000',
          origin: 'https://attacker.example',
          'x-marketplace-request': '1',
        },
      })
    ).statusCode,
    403
  )
  assert.equal(
    (await testInvoke({ headers: { host: 'localhost:3000' } })).statusCode,
    403
  )
  identity = null
  calls = []
  assert.equal((await testInvoke()).statusCode, 401)
  assert.equal(calls.length, 0)
  identity = user
  for (const [env, target] of [
    ['production', 'yzvchumzyonegujucyqs'],
    ['staging', 'yzvchumzyonegujucyqs'],
    ['production', ref],
    ['unknown', ref],
  ]) {
    config(env, target)
    calls = []
    assert.equal((await testInvoke()).statusCode, 503)
    assert.equal(calls.length, 0)
  }
  config()
  for (const request of [
    { query: { userId: other } },
    { body: { userId: other } },
    { query: { userId: other }, body: { payoutStatus: 'ready' } },
  ]) {
    calls = []
    const response = await invoke(request)
    assert.equal(response.statusCode, 200)
    assert.deepEqual(response.data, empty)
    assert.deepEqual(calls, [
      { name: 'marketplace_financial_capabilities', args: undefined },
    ])
  }
  identity = null
  calls = []
  assert.equal((await invoke()).statusCode, 401)
  assert.equal(calls.length, 0)
  identity = user
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'])
    assert.equal((await invoke({ method })).statusCode, 405)
  for (const [env, target] of [
    ['production', 'yzvchumzyonegujucyqs'],
    ['staging', 'yzvchumzyonegujucyqs'],
    ['production', ref],
    ['unknown', ref],
  ]) {
    config(env, target)
    calls = []
    assert.equal((await invoke()).statusCode, 503)
    assert.equal(calls.length, 0)
  }
  config()
  delete process.env.SUPABASE_SERVICE_ROLE_KEY
  await assert.rejects(service.isPayoutReady(user))
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    'e30.' +
    Buffer.from(
      JSON.stringify({ role: 'service_role', ref: 'yzvchumzyonegujucyqs' })
    ).toString('base64url') +
    '.test'
  await assert.rejects(service.getFinancialCapabilities(user))
  process.env.SUPABASE_SERVICE_ROLE_KEY =
    'e30.' +
    Buffer.from(JSON.stringify({ role: 'service_role', ref })).toString(
      'base64url'
    ) +
    '.test'
  assert.equal(await service.isPayoutReady(user), false)
  assert.equal(await service.hasUsablePaymentMethod(user), false)
  data = {
    paymentMethod: {
      status: 'set',
      brand: 'Test Brand',
      last4: '4242',
      providerInstrumentRef: 'opaque',
    },
    payoutAccount: { status: 'ready', institution: 'Test Bank', last4: '6789' },
    providerOwnerRef: 'opaque',
  }
  assert.equal(await service.isPayoutReady(user), true)
  assert.equal(await service.hasUsablePaymentMethod(user), true)
  const safe = (await invoke()).data
  assert.deepEqual(Object.keys(safe).sort(), ['paymentMethod', 'payoutAccount'])
  assert.deepEqual(Object.keys(safe.paymentMethod).sort(), [
    'brand',
    'last4',
    'status',
  ])
  assert.deepEqual(Object.keys(safe.payoutAccount).sort(), [
    'institution',
    'last4',
    'status',
  ])
  assert(!JSON.stringify(safe).includes('opaque'))
  calls = []
  await service.recordFinancialCapability({
    userId: user,
    capability: 'payment_method',
    status: 'unset',
  })
  assert.equal(calls[0].args.p_provider_instrument_ref, null)
  rpcError = { message: 'sensitive upstream diagnostic' }
  assert.equal((await invoke()).statusCode, 503)
  assert(!JSON.stringify((await invoke()).data).includes('sensitive'))
  assert.throws(() =>
    service.projectFinancialCapabilities({
      paymentMethod: { status: 'bogus' },
      payoutAccount: { status: 'ready' },
    })
  )
  const sql = fs.readFileSync(
    'supabase/migrations/202610100003_financial_capabilities.sql',
    'utf8'
  )
  assert(sql.includes('primary key (user_id,capability)'))
  assert(sql.includes('references public.profiles(id) on delete cascade'))
  assert(sql.includes('enable row level security'))
  assert(
    !/create policy|grant (insert|update|delete|select)|alter table public\.|update public\.|insert into public\.(orders|listings|order_requests)/i.test(
      sql
    )
  )
  assert.equal(
    (sql.match(/security definer set search_path = ''/g) || []).length,
    4
  )
  assert(sql.includes('to service_role'))
  assert(sql.includes('from public,anon,authenticated,service_role'))
  assert(sql.includes('financial_capabilities_projection(auth.uid())'))
  for (const [file, hash] of [
    [
      '202610100001_order_requests.sql',
      '5fae29019242fe24af2491805d06dd513051311e25811306387d7b0788dd775f',
    ],
    [
      '202610100002_order_accept.sql',
      'b1473cc9ac9330e535e6a9eaa8efebd2f66c895d904bb13e3429a862c0f47d02',
    ],
  ])
    assert.equal(
      require('crypto')
        .createHash('sha256')
        .update(fs.readFileSync('supabase/migrations/' + file))
        .digest('hex'),
      hash
    )
  for (const dir of ['components', 'hooks'])
    for (const file of walk(dir))
      assert(
        !fs
          .readFileSync(file, 'utf8')
          .includes('financial-capabilities-service'),
        'No privileged service imported by browser'
      )
  console.log(
    'PASS financial API/defaults/auth/identity injection/read allowlist/trusted helpers/environment guards/static SQL/immutable migrations/server-only imports'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
function walk(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? walk(path.join(dir, e.name))
        : /\.[jt]sx?$/.test(e.name)
        ? [path.join(dir, e.name)]
        : []
    )
}
