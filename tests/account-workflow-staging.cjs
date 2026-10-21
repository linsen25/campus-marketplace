// Opt-in B02 qualification. Exactly two disposable Staging users, no SMTP calls.
/* global Request */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
assert.equal(process.env.B02_STAGING_WRITE_APPROVED, '1')
const ref = 'pcaqxezdfxofysghssyo'
const origin = `https://${ref}.supabase.co`
const environment =
  require('../scripts/v2-maintenance-staging.cjs').environment()
assert.equal(environment.NEXT_PUBLIC_SUPABASE_URL, origin)
for (const key of [
  'APP_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
])
  process.env[key] = environment[key]
const nativeFetch = global.fetch
let transportCount = 0
global.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input))
  assert.equal(
    url.origin,
    origin,
    'Only the explicit Staging origin is allowed'
  )
  assert(
    ![
      '/auth/v1/signup',
      '/auth/v1/recover',
      '/auth/v1/resend',
      '/auth/v1/otp',
    ].includes(url.pathname),
    'Email-sending endpoints are prohibited'
  )
  transportCount++
  return nativeFetch(input, init)
}
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const admin = createClient(
  origin,
  environment.SUPABASE_SERVICE_ROLE_KEY,
  options
)
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
    (name) => {
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
      if (name.startsWith('.'))
        return load(path.resolve(path.dirname(full), name + '.ts'))
      return require(name)
    },
    mod,
    mod.exports
  )
  return mod.exports
}
const handlers = {
  auth: load('pages/api/auth/[action].ts').default,
  account: load('pages/api/profile/account.ts').default,
  username: load('pages/api/profile/username.ts').default,
  preferences: load('pages/api/notification-preferences.ts').default,
}
const { createMarketplaceClient } = load('lib/supabase/server.ts')
const runId = crypto.randomUUID()
const folder = path.resolve('tests/artifacts/b02')
fs.mkdirSync(folder, { recursive: true })
const journal = path.join(folder, `account-run-${runId}.json`)
const users = [],
  checks = []
let step = 'initial',
  cleanupComplete = false
function save() {
  fs.writeFileSync(
    journal,
    JSON.stringify(
      {
        runId,
        projectRef: ref,
        users: users.map(({ id, cleaned }) => ({ id, cleaned })),
        checks,
        step,
        cleanupComplete,
        transportCount,
        noEmailEndpoints: true,
      },
      null,
      2
    )
  )
}
function pass(name) {
  checks.push(name)
  save()
  console.log('PASS ' + name)
}
function context(u, method, query = {}, body, extra = {}) {
  const headers = new Map()
  const req = {
    method,
    query,
    body,
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'x-marketplace-request': '1',
      cookie: Array.from(u.cookies, ([k, v]) => `${k}=${v}`).join('; '),
      ...extra,
    },
  }
  const res = {
    code: 200,
    getHeader: (n) => headers.get(n),
    setHeader: (n, v) => headers.set(n, v),
    status(n) {
      this.code = n
      return this
    },
    json(value) {
      this.body = value
      return this
    },
  }
  return { req, res, headers }
}
function remember(u, ctx) {
  for (const cookie of ctx.headers.get('Set-Cookie') || []) {
    assert.match(cookie, /HttpOnly/i)
    const pair = cookie.split(';')[0],
      i = pair.indexOf('=')
    if (/Max-Age=0/i.test(cookie)) u.cookies.delete(pair.slice(0, i))
    else u.cookies.set(pair.slice(0, i), pair.slice(i + 1))
  }
}
async function api(u, kind, method, query, body, expected = 200, extra) {
  const ctx = context(u, method, query, body, extra)
  await handlers[kind](ctx.req, ctx.res)
  remember(u, ctx)
  assert.equal(
    ctx.res.code,
    expected,
    `${step}: ${kind} expected ${expected}, received ${ctx.res.code}`
  )
  assert.match(ctx.headers.get('Cache-Control'), /no-store/)
  return ctx.res.body
}
const input = (u, values = {}) => ({
  email: u.email,
  password: u.password,
  username: u.username,
  agreement: true,
  ...values,
})
async function ok(result) {
  assert(!result.error, 'Provider request rejected at step: ' + step)
  return result.data
}
async function code(u, type = 'signup') {
  const data = await ok(
    await admin.auth.admin.generateLink({
      type,
      email: u.email,
      ...(type === 'signup' ? { password: u.password } : {}),
    })
  )
  assert.equal(data.user.id, u.id)
  assert(/^[0-9]{6,10}$/.test(data.properties.email_otp))
  return data.properties.email_otp
}
async function main() {
  save()
  try {
    step = 'create two disposable users without sending email'
    for (let i = 0; i < 2; i++) {
      const ticket = crypto.randomBytes(32).toString('hex')
      const u = {
        username: 'B02_' + runId.replaceAll('-', '').slice(0, 10) + i,
        email: `b02-${runId}-${i}@uwo.ca`,
        password: crypto.randomBytes(20).toString('hex') + 'Aa1!',
        cookies: new Map([['marketplace-pending-signup', ticket]]),
      }
      const data = await ok(
        await admin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: false,
          user_metadata: {
            username: u.username,
            pending_signup_ticket: ticket,
            b02QualificationRun: runId,
          },
        })
      )
      u.id = data.user.id
      users.push(u)
      save()
    }
    const [a, b] = users
    pass('Two new run-scoped Auth users created; existing users untouched')
    step = 'anonymous and wrong origin'
    const anonymous = { cookies: new Map() }
    await api(anonymous, 'account', 'GET', {}, undefined, 401)
    await api(anonymous, 'preferences', 'GET', {}, undefined, 401)
    await api(a, 'auth', 'POST', { action: 'sign-in' }, input(a), 403, {
      origin: 'https://wrong.invalid',
    })
    pass('Anonymous account/preferences and wrong-origin login rejected')
    step = 'unverified account'
    await api(a, 'auth', 'POST', { action: 'sign-in' }, input(a), 400)
    await api(a, 'account', 'GET', {}, undefined, 401)
    pass('Unverified Western login rejected by real Auth provider')
    step = 'pending correction and duplicate username'
    const oldCode = await code(a)
    await api(
      a,
      'auth',
      'POST',
      { action: 'correct-signup-username' },
      input(a, { username: b.username }),
      409
    )
    const corrected = 'B02C_' + runId.replaceAll('-', '').slice(0, 10)
    await api(
      a,
      'auth',
      'POST',
      { action: 'correct-signup-username' },
      input(a, { username: corrected })
    )
    a.username = corrected
    await api(
      a,
      'auth',
      'POST',
      { action: 'verify-signup' },
      input(a, { code: oldCode }),
      400
    )
    const state = await api(a, 'auth', 'GET', {
      action: 'pending-signup-state',
    })
    assert.deepEqual(state, { resumable: true })
    pass(
      'Pending duplicate name rejected, correction persists, old OTP invalidated, proof resumable'
    )
    step = 'verify actual signup OTPs without mail'
    for (const u of users) {
      await api(
        u,
        'auth',
        'POST',
        { action: 'verify-signup' },
        input(u, { code: await code(u) })
      )
      const account = await api(u, 'account', 'GET', {
        userId: users.find((v) => v !== u).id,
      })
      assert.equal(account.username, u.username)
      assert.equal(account.email, u.email)
      assert(account.emailVerified)
      assert(!JSON.stringify(account).includes('access_token'))
      assert(!u.cookies.has('marketplace-pending-signup'))
      assert.equal(
        (await api(u, 'auth', 'GET', { action: 'session' })).seller.id,
        u.id
      )
    }
    pass(
      'Both real OTP verifications create sessions; reload and own-profile projection succeed'
    )
    step = 'username restrictions'
    await api(a, 'username', 'POST', {}, { username: 'admin' }, 400)
    await api(a, 'username', 'POST', {}, { username: 'bad name' }, 400)
    const same = await api(a, 'username', 'POST', {}, { username: a.username })
    assert.equal(same.username, a.username)
    assert(new Date(same.next_change_allowed_at) > new Date())
    await api(
      a,
      'username',
      'POST',
      {},
      { username: 'B02N_' + runId.replaceAll('-', '').slice(0, 10) },
      400
    )
    await api(
      a,
      'auth',
      'POST',
      { action: 'correct-signup-username' },
      input(a),
      403
    )
    pass(
      'Reserved/invalid names, verified cooldown, no-op, pending-proof reuse restrictions enforced'
    )
    step = 'independent preference persistence'
    const defaults = { inApp: true, sounds: false, email: true }
    assert.deepEqual(await api(b, 'preferences', 'GET', {}), defaults)
    await Promise.all([
      api(a, 'preferences', 'POST', {}, { key: 'inApp', value: false }),
      api(a, 'preferences', 'POST', {}, { key: 'sounds', value: true }),
    ])
    await api(a, 'preferences', 'POST', {}, { key: 'email', value: false })
    const wanted = { inApp: false, sounds: true, email: false }
    assert.deepEqual(await api(a, 'preferences', 'GET', {}), wanted)
    assert.deepEqual(await api(b, 'preferences', 'GET', {}), defaults)
    const client = createMarketplaceClient(context(a, 'GET'))
    const token = (await client.auth.getSession()).data.session.access_token
    const ownClient = createClient(
      origin,
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { ...options, global: { headers: { Authorization: 'Bearer ' + token } } }
    )
    const hidden = await ok(
      await ownClient
        .from('notification_preferences')
        .select('*')
        .eq('user_id', b.id)
    )
    assert.deepEqual(hidden, [])
    const forbidden = await ownClient
      .from('notification_preferences')
      .update({ email_notifications: false })
      .eq('user_id', b.id)
    assert(forbidden.error, 'Direct preference writes must remain denied')
    pass(
      'Concurrent partial preferences persist; second user untouched; cross-user RLS/direct write denied'
    )
    step = 'refresh and logout'
    const ctx = context(a, 'GET'),
      refreshClient = createMarketplaceClient(ctx)
    await ok(await refreshClient.auth.refreshSession())
    remember(a, ctx)
    const refresh = (await refreshClient.auth.getSession()).data.session
      .refresh_token
    assert.equal(
      (await api(a, 'auth', 'GET', { action: 'session' })).seller.id,
      a.id
    )
    await api(a, 'auth', 'POST', { action: 'sign-out' })
    assert.deepEqual(
      (await api(a, 'auth', 'GET', { action: 'session' })).seller,
      null
    )
    await api(a, 'account', 'GET', {}, undefined, 401)
    const replay = createClient(
      origin,
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      options
    )
    const invalid = await replay.auth.refreshSession({ refresh_token: refresh })
    assert(invalid.error, 'Signed-out session refresh must be revoked')
    await api(a, 'auth', 'POST', { action: 'sign-in' }, input(a))
    assert.deepEqual(await api(a, 'preferences', 'GET', {}), wanted)
    pass(
      'Real refresh, logout cookie clearing, refresh-token revocation, relogin preference persistence'
    )
    step = 'recovery token without password update/mail'
    const recovery = await code(b, 'recovery')
    const recoveryClient = createClient(
      origin,
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      options
    )
    const recovered = await ok(
      await recoveryClient.auth.verifyOtp({
        email: b.email,
        token: recovery,
        type: 'recovery',
      })
    )
    assert.equal(recovered.user.id, b.id)
    await ok(await recoveryClient.auth.signOut({ scope: 'local' }))
    pass(
      'Real provider recovery token verifies without email; password update intentionally not exercised'
    )
    step = 'completed'
  } finally {
    for (const u of users) {
      const found = await admin.auth.admin.getUserById(u.id)
      assert.equal(
        found.data.user?.user_metadata?.b02QualificationRun,
        runId,
        'Cleanup only this run'
      )
      await ok(await admin.auth.admin.deleteUser(u.id))
      const absent = await admin.auth.admin.getUserById(u.id)
      assert(!absent.data.user)
      u.cookies.clear()
      u.cleaned = true
      save()
    }
    cleanupComplete = true
    save()
    console.log('PASS exact two-user cleanup; no email endpoints called')
  }
}
main().catch(() => {
  save()
  console.error(
    'B02 Staging verification stopped at: ' +
      step +
      '; sanitized evidence: ' +
      journal
  )
  process.exitCode = 1
})
