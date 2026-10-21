// B02: actual API/SSR SDK with fully intercepted transport; no remote accounts/mail.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const mod = { exports: {} }
  cache.set(full, mod.exports)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    mod,
    mod.exports
  )
  return mod.exports
}
async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-public-key'
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'offline@uwo.ca',
    email_confirmed_at: '2026-10-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
  }
  let expired = false,
    refreshRejected = false,
    revoked = false,
    profileFailure = false
  const calls = []
  const token = () =>
    [
      Buffer.from('{"alg":"HS256"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: user.id,
          exp: Math.floor(Date.now() / 1000) + (expired ? -120 : 3600),
        })
      ).toString('base64url'),
      'offline-signature',
    ].join('.')
  const json = (value, status = 200) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  global.fetch = async (input, init = {}) => {
    const url = new URL(String(input))
    assert.equal(url.origin, 'http://127.0.0.1:54321')
    calls.push({
      path: url.pathname,
      query: url.searchParams,
      method: init.method,
    })
    if (url.pathname === '/auth/v1/token') {
      if (refreshRejected)
        return json(
          { code: 'refresh_token_not_found', message: 'Invalid Refresh Token' },
          400
        )
      return json({
        access_token: token(),
        refresh_token: 'offline-refresh',
        expires_in: expired ? -120 : 3600,
        token_type: 'bearer',
        user,
      })
    }
    if (url.pathname === '/auth/v1/user')
      return revoked
        ? json({ code: 'session_not_found', message: 'Session not found' }, 401)
        : json(user)
    if (url.pathname === '/rest/v1/profiles') {
      assert.equal(url.searchParams.get('id'), 'eq.' + user.id)
      assert.equal(url.searchParams.get('select'), 'username,avatar_path')
      return profileFailure
        ? json({ message: 'PRIVATE_DATABASE_DIAGNOSTIC', code: 'XX000' }, 500)
        : json({ username: 'OfflineMember' })
    }
    throw Error('Unexpected offline request: ' + url.pathname)
  }
  const { createMarketplaceClient } = load('lib/supabase/server.ts')
  const account = load('pages/api/profile/account.ts').default
  const auth = load('pages/api/auth/[action].ts').default
  const jar = new Map()
  function context(method = 'GET', query = {}) {
    const headers = new Map()
    const res = {
      statusCode: 200,
      getHeader: (key) => headers.get(key),
      setHeader: (key, value) => headers.set(key, value),
      status(code) {
        this.statusCode = code
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    const req = {
      method,
      query,
      headers: {
        host: 'localhost:3000',
        cookie: Array.from(jar, ([key, value]) => `${key}=${value}`).join('; '),
      },
    }
    return { req, res, headers }
  }
  function remember(ctx) {
    for (const cookie of ctx.headers.get('Set-Cookie') || []) {
      assert.match(cookie, /HttpOnly/i)
      const pair = cookie.split(';')[0]
      const i = pair.indexOf('=')
      const name = pair.slice(0, i)
      if (/Max-Age=0/i.test(cookie)) jar.delete(name)
      else jar.set(name, pair.slice(i + 1))
    }
  }
  async function login() {
    const ctx = context()
    const result = await createMarketplaceClient(ctx).auth.signInWithPassword({
      email: user.email,
      password: 'OfflinePassword1!',
    })
    assert.equal(result.error, null)
    remember(ctx)
  }
  let ctx = context()
  await account(ctx.req, ctx.res)
  assert.equal(ctx.res.statusCode, 401)
  await login()
  ctx = context('GET', { userId: 'other-user', id: 'other-user' })
  await account(ctx.req, ctx.res)
  assert.equal(ctx.res.statusCode, 200)
  assert.deepEqual(ctx.res.body, {
    username: 'OfflineMember',
    email: user.email,
    emailVerified: true,
    createdAt: user.created_at,
    nextUsernameChangeAt: null,
    avatarUrl: null,
    avatarVersion: null,
  })
  assert.match(ctx.headers.get('Cache-Control'), /private.*no-store/)
  assert(!JSON.stringify(ctx.res.body).includes('offline-refresh'))
  assert(!JSON.stringify(ctx.res.body).includes('access_token'))
  profileFailure = true
  ctx = context()
  await account(ctx.req, ctx.res)
  assert.equal(ctx.res.statusCode, 503)
  assert(!JSON.stringify(ctx.res.body).includes('PRIVATE_DATABASE_DIAGNOSTIC'))
  profileFailure = false
  for (const [email, verified] of [
    ['offline@uwo.ca', null],
    ['offline@uwo.ca.evil.test', '2026-10-01T00:00:00Z'],
  ]) {
    user.email = email
    user.email_confirmed_at = verified
    const count = calls.filter((call) => call.path.endsWith('/profiles')).length
    ctx = context()
    await account(ctx.req, ctx.res)
    assert.equal(ctx.res.statusCode, 403)
    assert.equal(
      calls.filter((call) => call.path.endsWith('/profiles')).length,
      count
    )
  }
  user.email = 'offline@uwo.ca'
  user.email_confirmed_at = '2026-10-01T00:00:00Z'
  revoked = true
  ctx = context('GET', { action: 'session' })
  await auth(ctx.req, ctx.res)
  assert.equal(ctx.res.statusCode, 200)
  assert.deepEqual(ctx.res.body, { seller: null })
  revoked = false
  jar.clear()
  expired = true
  await login()
  refreshRejected = true
  ctx = context()
  await account(ctx.req, ctx.res)
  assert.equal(ctx.res.statusCode, 401)
  remember(ctx)
  assert.equal(jar.size, 0, 'Rejected refresh removes stale Auth cookies')
  ctx = context('GET', { action: 'session' })
  await auth(ctx.req, ctx.res)
  assert.deepEqual(ctx.res.body, { seller: null })
  const before = calls.length
  ctx = context('PATCH')
  await account(ctx.req, ctx.res)
  assert.equal(ctx.res.statusCode, 405)
  assert.equal(calls.length, before)
  console.log(
    'PASS B02: own-account projection, forged identity ignored, no-store/redaction, unverified/domain rejection, revoked session, expired refresh rejection/cookie cleanup, method guard; actual SDK with mocked HTTP, zero remote requests.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
