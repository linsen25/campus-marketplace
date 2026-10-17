const fs = require('node:fs')
const ts = require('typescript')
const assert = require('node:assert/strict')
let auth = true,
  origin = true,
  staging = true,
  calls = [],
  failure = false
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const moduleUnderTest = { exports: {} }
const compiled = ts.transpileModule(
  fs.readFileSync('pages/api/notification-preferences.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText
new Function('require', 'module', 'exports', compiled)(
  (name) => {
    if (name === '@/lib/listing-validation')
      return { ListingApiError: ApiError }
    if (name === '@/lib/notification-preferences')
      return {
        notificationPreferenceKeys: ['inApp', 'sounds', 'email'],
        validNotificationPreferences: (v) =>
          v &&
          ['inApp', 'sounds', 'email'].every((k) => typeof v[k] === 'boolean'),
      }
    if (name === '@/lib/server/financial-capabilities-service')
      return {
        requireFinancialEnvironment() {
          if (!staging) throw new ApiError('Staging required', 503)
        },
      }
    if (name === '@/lib/server/marketplace-auth')
      return {
        requireMarketplaceUser: async () => {
          if (!auth) throw new ApiError('Sign in', 401)
        },
        requireSameOriginWrite() {
          if (!origin) throw new ApiError('Origin rejected', 403)
        },
      }
    if (name === '@/lib/supabase/server')
      return {
        createMarketplaceClient() {
          return {
            rpc: async (name, params) => {
              calls.push({ name, params })
              return {
                data: { inApp: true, sounds: false, email: true },
                error: failure
                  ? { code: '42501', message: 'private diagnostic' }
                  : null,
              }
            },
          }
        },
      }
    throw Error('Unexpected dependency ' + name)
  },
  moduleUnderTest,
  moduleUnderTest.exports
)
const handler = moduleUnderTest.exports.default
async function request(method, body = {}, query = {}) {
  const res = {
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
  await handler({ method, body, query }, res)
  return res
}
(async () => {
  let r = await request('GET')
  assert.equal(r.code, 200)
  assert.equal(r.headers['Cache-Control'], 'private, no-store')
  assert.deepEqual(r.body, { inApp: true, sounds: false, email: true })
  assert.equal(calls.at(-1).name, 'marketplace_notification_preferences')
  for (const key of ['inApp', 'sounds', 'email']) {
    r = await request('POST', { key, value: false })
    assert.equal(r.code, 200)
    assert.deepEqual(calls.at(-1), {
      name: 'marketplace_set_notification_preference',
      params: { p_key: key, p_value: false },
    })
  }
  for (const body of [
    { key: 'email', value: 'false' },
    { key: 'userId', value: true },
    { key: 'email', value: false, userId: 'victim' },
    [],
    null,
  ])
    assert.equal((await request('POST', body)).code, 400)
  assert.equal((await request('GET', {}, { userId: 'victim' })).code, 400)
  origin = false
  assert.equal(
    (await request('POST', { key: 'email', value: false })).code,
    403
  )
  origin = true
  auth = false
  assert.equal((await request('GET')).code, 401)
  auth = true
  staging = false
  assert.equal((await request('GET')).code, 503)
  staging = true
  failure = true
  r = await request('GET')
  assert.equal(r.code, 403)
  assert(!JSON.stringify(r.body).includes('private diagnostic'))
  assert.equal((await request('DELETE')).code, 405)
  console.log(
    'PASS preference API: staging, session, CSRF, no-store, exact keys/boolean validation, no actor injection, sanitized errors; zero network'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
