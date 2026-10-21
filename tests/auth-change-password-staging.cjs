// B04 opt-in acceptance. Exact Staging, only this run's disposable users, no mail.
/* global Request, fetch */
const assert = require('node:assert/strict'),
  crypto = require('node:crypto'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
const { createClient } = require('@supabase/supabase-js')
assert.equal(process.env.B04_STAGING_WRITE_APPROVED, '1')
assert.equal(process.env.B04_NO_EMAIL_DASHBOARD_CONFIRMED, '1')
const { environment, query } = require('../scripts/v2-maintenance-staging.cjs')
const env = environment(),
  ref = 'pcaqxezdfxofysghssyo',
  origin = `https://${ref}.supabase.co`
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, origin)
for (const key of [
  'APP_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
])
  process.env[key] = env[key]
const runId = crypto.randomUUID(),
  users = [],
  checks = [],
  actions = []
const folder = path.resolve('tests/artifacts/b04-' + runId)
fs.mkdirSync(folder, { recursive: true })
let step = 'initial',
  cleanupComplete = false,
  failure = false
const save = () =>
  fs.writeFileSync(
    path.join(folder, 'result.json'),
    JSON.stringify(
      {
        runId,
        projectRef: ref,
        step,
        checks,
        users: users.map((u) => ({ id: u.id, cleaned: u.cleaned || false })),
        cleanupComplete,
        failure,
        actions,
        dashboardConfirmed: {
          passwordChangedNotification: false,
          securePasswordChange: false,
          requireCurrentPassword: false,
        },
      },
      null,
      2
    )
  )
function pass(name) {
  checks.push(name)
  save()
  console.log('PASS ' + name)
}
const nativeFetch = global.fetch
function subject(token) {
  try {
    return JSON.parse(Buffer.from(token.split('.')[1], 'base64url')).sub
  } catch {
    return null
  }
}
global.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input)),
    method = init.method || 'GET'
  assert.equal(url.origin, origin, 'Only explicitly authorized Staging')
  assert(
    !/\/(signup|recover|resend|otp|reauthenticate|verify|invite|generate_link)$/.test(
      url.pathname
    ),
    'No email/OTP/recovery endpoints'
  )
  const headers = new Headers(init.headers),
    body = init.body ? JSON.parse(init.body) : null
  if (method !== 'GET') {
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      assert.equal(body.user_metadata.b04QualificationRun, runId)
      assert(
        body.email.startsWith('b04-' + runId + '-') &&
          body.email.endsWith('@uwo.ca')
      )
      assert.equal(body.email_confirm, true)
    } else if (url.pathname === '/auth/v1/token' && method === 'POST') {
      if (url.searchParams.get('grant_type') === 'password')
        assert(users.some((u) => u.email === body.email))
      else assert.equal(url.searchParams.get('grant_type'), 'refresh_token')
    } else if (
      url.pathname.startsWith('/auth/v1/admin/users/') &&
      method === 'DELETE'
    ) {
      assert(users.some((u) => url.pathname.endsWith('/' + u.id)))
    } else if (
      (url.pathname === '/auth/v1/user' && method === 'PUT') ||
      (url.pathname === '/auth/v1/logout' && method === 'POST')
    ) {
      assert(
        users.some(
          (u) =>
            u.id ===
            subject(headers.get('authorization')?.replace('Bearer ', ''))
        )
      )
    } else throw Error('Unexpected write endpoint blocked')
  }
  const response = await nativeFetch(input, init)
  let code
  if (!response.ok) {
    const data = await response
      .clone()
      .json()
      .catch(() => ({}))
    code = data.code || data.error_code
  }
  actions.push({
    path: url.pathname.replace(
      /\/admin\/users\/.+$/,
      '/admin/users/<run-user>'
    ),
    method,
    status: response.status,
    ...(url.searchParams.has('scope')
      ? { scope: url.searchParams.get('scope') }
      : {}),
    ...(code ? { code } : {}),
  })
  if (/reauthentication|email.*(send|rate)|smtp/i.test(code || ''))
    throw Error('Unexpected email or reauthentication requirement')
  return response
}
const options = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const admin = createClient(origin, env.SUPABASE_SERVICE_ROLE_KEY, options)
const publicClient = () =>
  createClient(origin, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, options)
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const handler = load('pages/api/auth/[action].ts').default
const { createMarketplaceClient } = load('lib/supabase/server.ts')
function context(device, method = 'GET', action = 'session', body = {}) {
  const h = new Map(),
    req = {
      method,
      query: { action },
      body,
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
        cookie: [...device.cookies].map(([k, v]) => k + '=' + v).join('; '),
      },
    }
  const res = {
    code: 200,
    getHeader: (k) => h.get(k),
    setHeader: (k, v) => h.set(k, v),
    status(n) {
      this.code = n
      return this
    },
    json(b) {
      this.body = b
      return this
    },
  }
  return { req, res, h }
}
function remember(device, ctx) {
  for (const value of ctx.h.get('Set-Cookie') || []) {
    assert.match(value, /HttpOnly/i)
    const pair = value.split(';')[0],
      i = pair.indexOf('=')
    if (/Max-Age=0/i.test(value)) device.cookies.delete(pair.slice(0, i))
    else device.cookies.set(pair.slice(0, i), pair.slice(i + 1))
  }
}
async function api(device, action, body = {}, expected = 200) {
  const ctx = context(
    device,
    action === 'session' ? 'GET' : 'POST',
    action,
    body
  )
  await handler(ctx.req, ctx.res)
  remember(device, ctx)
  assert.equal(ctx.res.code, expected, 'Unexpected API status at ' + step)
  return ctx.res.body
}
async function ok(p) {
  const r = await p
  assert(!r.error, 'Provider rejected request at ' + step)
  return r.data
}
const device = () => ({ cookies: new Map() })
async function token(device) {
  return (await ok(createMarketplaceClient(context(device)).auth.getSession()))
    .session
}
async function identity(device) {
  const c = context(device)
  const user = await ok(createMarketplaceClient(c).auth.getUser())
  remember(device, c)
  return user.user.id
}
async function login(device, user, password = user.password) {
  return api(device, 'sign-in', { email: user.email, password })
}
function password() {
  return crypto.randomBytes(24).toString('base64url') + 'Aa1!'
}
const originalConsoleError = console.error
console.error = () => {} // Provider failure tests must never dump raw errors/credentials.
async function main() {
  save()
  try {
    step = 'read-only target health'
    const health = await okResponse(
      await fetch(origin + '/auth/v1/health', {
        headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
      })
    )
    pass('Explicit Staging health verified: ' + health.version)
    step = 'create two isolated run-scoped accounts without mail'
    for (let i = 0; i < 2; i++) {
      const u = {
        email: `b04-${runId}-${i}@uwo.ca`,
        password: password(),
        username: 'B04_' + runId.replaceAll('-', '').slice(0, 10) + i,
      }
      const data = await ok(
        admin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { username: u.username, b04QualificationRun: runId },
        })
      )
      u.id = data.user.id
      users.push(u)
      save()
    }
    pass(
      'Two uniquely marked temporary accounts created via no-email Admin createUser'
    )
    const [a, b] = users,
      A = device(),
      other = device(),
      B = device()
    await login(A, a)
    await login(other, a)
    await login(B, b)
    const aSession = await token(A),
      otherSession = await token(other),
      bSession = await token(B)
    pass(
      'Two independent devices for subject and isolated control-account session'
    )
    step = 'reject incorrect current password while native enforcement is OFF'
    const next = password(),
      writesBefore = actions.filter(
        (x) => x.path === '/auth/v1/user' && x.method === 'PUT'
      ).length
    const rejected = await api(
      A,
      'change-password',
      { currentPassword: password(), password: next, confirmation: next },
      400
    )
    assert.equal(rejected.passwordUpdated, false)
    assert.equal(
      actions.filter((x) => x.path === '/auth/v1/user' && x.method === 'PUT')
        .length,
      writesBefore
    )
    const proof = publicClient()
    await ok(
      proof.auth.signInWithPassword({ email: a.email, password: a.password })
    )
    await ok(proof.auth.signOut({ scope: 'local' }))
    pass(
      'Wrong old password rejected by UU before any password PUT; original password still works with native current-password requirement OFF'
    )
    step = 'policy and cross-account protection'
    await api(
      A,
      'change-password',
      { currentPassword: a.password, password: 'short', confirmation: 'short' },
      400
    )
    await api(
      A,
      'change-password',
      { currentPassword: a.password, password: next, confirmation: password() },
      400
    )
    await api(
      A,
      'change-password',
      {
        currentPassword: a.password,
        password: next,
        confirmation: next,
        userId: b.id,
      },
      400
    )
    await api(
      device(),
      'change-password',
      { currentPassword: a.password, password: next, confirmation: next },
      401
    )
    pass(
      'Policy, confirmation, forged target and unauthenticated requests rejected'
    )
    step = 'real authenticated password update and others revocation'
    const result = await api(A, 'change-password', {
      currentPassword: a.password,
      password: next,
      confirmation: next,
    })
    assert.deepEqual(
      result,
      { passwordUpdated: true, otherSessionsRevoked: true },
      'STOP: password/session result not fully confirmed'
    )
    assert.equal(await identity(A), a.id)
    const current = await token(A)
    assert.equal(
      JSON.parse(Buffer.from(current.access_token.split('.')[1], 'base64url'))
        .session_id,
      JSON.parse(Buffer.from(aSession.access_token.split('.')[1], 'base64url'))
        .session_id,
      'Original current device retained'
    )
    pass(
      'Actual password update and others-scope logout confirmed; original device session remains usable'
    )
    step = 'current device refresh and other device revocation'
    const ctx = context(A),
      client = createMarketplaceClient(ctx)
    await ok(client.auth.refreshSession())
    remember(A, ctx)
    assert.equal(await identity(A), a.id)
    const revoked = await publicClient().auth.refreshSession({
      refresh_token: otherSession.refresh_token,
    })
    assert(revoked.error, 'STOP: other device refresh unexpectedly succeeds')
    pass('Current device refresh succeeds; second-device refresh is rejected')
    step = 'new and old password login'
    const old = await publicClient().auth.signInWithPassword({
      email: a.email,
      password: a.password,
    })
    assert(old.error, 'STOP: old password unexpectedly accepted')
    const fresh = device()
    await login(fresh, a, next)
    assert.equal(await identity(fresh), a.id)
    a.password = next
    pass('New password login succeeds and old password login fails')
    step = 'control account remains unaffected'
    assert.equal(await identity(B), b.id)
    const control = await ok(
      publicClient().auth.refreshSession({
        refresh_token: bSession.refresh_token,
      })
    )
    assert.equal(control.user.id, b.id)
    const controlLogin = publicClient()
    await ok(
      controlLogin.auth.signInWithPassword({
        email: b.email,
        password: b.password,
      })
    )
    await ok(controlLogin.auth.signOut({ scope: 'local' }))
    pass(
      'Control account password, identity and existing refresh session remain unaffected'
    )
    assert(
      !actions.some((x) =>
        /signup|recover|resend|otp|reauthenticate|verify|invite|generate_link/.test(
          x.path
        )
      )
    )
    pass(
      'No mail/OTP/recovery endpoints; no unexpected reauthentication response observed'
    )
    step = 'completed'
  } catch {
    failure = true
    save()
    throw Error('Acceptance stopped')
  } finally {
    let cleanupFailed = false
    for (const u of users) {
      try {
        const found = await ok(admin.auth.admin.getUserById(u.id))
        assert.equal(found.user.user_metadata.b04QualificationRun, runId)
        await ok(admin.auth.admin.deleteUser(u.id))
        const absent = await admin.auth.admin.getUserById(u.id)
        assert(!absent.data.user)
        const rows = query(
          `begin read only;select (select count(*) from auth.users where id='${u.id}') users,(select count(*) from auth.identities where user_id='${u.id}') identities,(select count(*) from auth.sessions where user_id='${u.id}') sessions,(select count(*) from auth.refresh_tokens where user_id='${u.id}') refresh_tokens,(select count(*) from public.profiles where id='${u.id}') profiles,(select count(*) from public.notification_preferences where user_id='${u.id}') preferences,(select count(*) from marketplace_private.profile_avatar_uploads where owner_id='${u.id}') avatar_uploads,(select count(*) from storage.objects where bucket_id='profile-avatars' and name like '${u.id}/%') avatar_objects;rollback;`
        )[0]
        assert(
          Object.values(rows).every((n) => Number(n) === 0),
          'Run-owned resource residue'
        )
        u.cleaned = true
        save()
      } catch {
        cleanupFailed = true
        failure = true
        save()
      }
    }
    cleanupComplete = !cleanupFailed
    save()
    console.error = originalConsoleError
    if (cleanupFailed) {
      process.exitCode = 1
      console.error('B04 cleanup incomplete; consult sanitized run journal')
    } else
      console.log(
        'PASS only this run accounts/resources cleaned; zero users, identities, sessions, refresh tokens, profiles, preferences, avatar records/objects remain'
      )
  }
}
async function okResponse(response) {
  assert(response.ok)
  return response.json()
}
main().catch(() => {
  failure = true
  save()
  console.error = originalConsoleError
  console.error(
    'B04 stopped at ' +
      step +
      '; sanitized evidence: ' +
      path.join(folder, 'result.json')
  )
  process.exitCode = 1
})
