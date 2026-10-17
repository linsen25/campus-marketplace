const fs = require('node:fs'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
let user = true,
  origin = true,
  environment = true,
  fail = false,
  calls = []
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const client = {
  auth: {
    getUser: async () => ({
      data: { user: user ? { id: 'actor' } : null },
      error: null,
    }),
  },
  rpc: async (name, args) => {
    calls.push({ name, args })
    return {
      data:
        name === 'marketplace_account_activity'
          ? {
              period: args.p_period,
              points: Array.from(
                {
                  length: args.p_period === '1D' ? 24 : parseInt(args.p_period),
                },
                (_, i) => ({
                  timestamp: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
                  label: String(i),
                  views: 0,
                  listings: 0,
                  sold: 0,
                  overall: 0,
                })
              ),
            }
          : { recorded: true },
      error: fail ? { message: 'private diagnostic' } : null,
    }
  },
}
const activity = { exports: {} }
new Function(
  'module',
  'exports',
  ts.transpileModule(fs.readFileSync('lib/account-activity.ts', 'utf8'), {
    compilerOptions: { module: 1 },
  }).outputText
)(activity, activity.exports)
const deps = {
  '@/lib/account-activity': activity.exports,
  '@/lib/listing-validation': { ListingApiError: ApiError },
  '@/lib/server/financial-capabilities-service': {
    requireFinancialEnvironment() {
      if (!environment) throw new ApiError('staging', 503)
    },
  },
  '@/lib/server/marketplace-auth': {
    requireSameOriginWrite() {
      if (!origin) throw new ApiError('origin', 403)
    },
    async requireMarketplaceUser() {
      if (!user) throw new ApiError('auth', 401)
      return { id: 'actor' }
    },
  },
  '@/lib/server/messages-environment': {
    messageUuid(v) {
      if (typeof v !== 'string' || !/^[a-f0-9-]{36}$/.test(v))
        throw new ApiError('uuid')
      return v
    },
  },
  '@/lib/supabase/server': {
    createMarketplaceClient() {
      return client
    },
  },
}
function load(file) {
  const m = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: 1, esModuleInterop: true },
    }).outputText
  )((n) => deps[n], m, m.exports)
  return m.exports.default
}
const get = load('pages/api/profile/activity.ts'),
  view = load('pages/api/listings/view.ts')
async function invoke(handler, req) {
  const r = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(n) {
      this.code = n
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  await handler({ query: {}, ...req }, r)
  assert.equal(r.headers['Cache-Control'], 'private, no-store')
  return r
}
(async () => {
  for (const period of ['1D', '7D', '30D']) {
    const r = await invoke(get, { method: 'GET', query: { period } })
    assert.equal(r.code, 200)
    assert.equal(r.body.points.length, period === '1D' ? 24 : parseInt(period))
    assert.deepEqual(calls.at(-1).args, { p_period: period })
  }
  assert.equal(
    (
      await invoke(get, {
        method: 'GET',
        query: { period: '7D', userId: 'other' },
      })
    ).code,
    400
  )
  assert.equal((await invoke(get, { method: 'POST' })).code, 405)
  user = false
  assert.equal(
    (await invoke(get, { method: 'GET', query: { period: '7D' } })).code,
    401
  )
  const body = {
    listingId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    eventId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  }
  assert.equal(
    (await invoke(view, { method: 'POST', body })).code,
    200,
    'anonymous accepted'
  )
  user = true
  assert.equal((await invoke(view, { method: 'POST', body })).code, 200)
  assert.equal(
    (
      await invoke(view, {
        method: 'POST',
        body: { ...body, ownerId: 'other' },
      })
    ).code,
    400
  )
  assert.equal(
    (
      await invoke(view, {
        method: 'POST',
        body: { ...body, created_at: 'now' },
      })
    ).code,
    400
  )
  assert.equal((await invoke(view, { method: 'GET' })).code, 405)
  origin = false
  assert.equal((await invoke(view, { method: 'POST', body })).code, 403)
  origin = true
  environment = false
  assert.equal((await invoke(view, { method: 'POST', body })).code, 503)
  environment = true
  fail = true
  const r = await invoke(get, { method: 'GET', query: { period: '7D' } })
  assert.equal(r.code, 503)
  assert(!JSON.stringify(r.body).includes('private diagnostic'))
  console.log(
    'PASS Activity/View APIs: methods, own account, exact periods/body, anonymous/authenticated, CSRF, staging guard, sanitized failures, no-store, aggregated contract; zero network'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
