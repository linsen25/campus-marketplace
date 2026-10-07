// Real Supabase SDK with a mocked HTTP transport: no live mail or credentials.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'public-test-key'
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@uwo.ca',
    email_confirmed_at: new Date().toISOString(),
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: {},
    user_metadata: {},
    identities: [{ id: 'test' }],
  }
  const token = [
    Buffer.from('{"alg":"HS256"}').toString('base64url'),
    Buffer.from(
      JSON.stringify({
        sub: user.id,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })
    ).toString('base64url'),
    'test-signature',
  ].join('.')
  const session = {
    access_token: token,
    refresh_token: 'test-refresh',
    token_type: 'bearer',
    expires_in: 3600,
    user,
  }
  let failure = null
  let passwordFailure = null
  const calls = []
  global.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname
    const input = options.body ? JSON.parse(options.body) : null
    calls.push({ pathname, input, method: options.method })
    const json = (data, status = 200) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json', 'X-Supabase-Api-Version': '2024-01-01' },
      })
    if (passwordFailure && pathname.endsWith('/user') && options.method === 'PUT')
      return json(passwordFailure.body, passwordFailure.status)
    if (failure && pathname.startsWith('/auth/') && !pathname.endsWith('/logout'))
      return json(failure.body, failure.status)
    if (pathname.endsWith('/rpc/marketplace_username_available')) return json(true)
    if (pathname.endsWith('/rpc/marketplace_confirm_username')) return json(null)
    if (pathname.endsWith('/profiles')) return json({ id: user.id, display_name: 'Test_member' })
    if (pathname.endsWith('/signup')) return json(user)
    if (pathname.endsWith('/otp')) {
      assert.equal(input.create_user, false, 'Legacy OTP must never create an Auth user')
      assert(!input.data?.username, 'Compatibility login must not invent a username')
      return input.email === user.email
        ? json({})
        : json({ code: 'otp_disabled', msg: 'Signups not allowed for otp' }, 400)
    }
    if (pathname.endsWith('/resend') || pathname.endsWith('/recover'))
      return json({})
    if (pathname.endsWith('/token') || pathname.endsWith('/verify'))
      return json(session)
    if (pathname.endsWith('/user')) return json(user)
    if (pathname.endsWith('/logout')) return new Response(null, { status: 204 })
    throw new Error('Unexpected request ' + pathname)
  }
  const handler = load('pages/api/auth/[action].ts').default
  async function request(action, body = {}, headers = {}) {
    const responseHeaders = new Map()
    const res = {
      statusCode: 200,
      getHeader: (n) => responseHeaders.get(n),
      setHeader: (n, v) => responseHeaders.set(n, v),
      status(n) {
        this.statusCode = n
        return this
      },
      json(data) {
        this.body = data
        return this
      },
    }
    await handler(
      {
        method: action === 'session' ? 'GET' : 'POST',
        query: { action },
        body,
        headers: {
          host: 'localhost:3100',
          origin: 'http://localhost:3100',
          'x-marketplace-request': '1',
          ...headers,
        },
      },
      res
    )
    return { ...res, headers: responseHeaders }
  }
  const input = {
    email: user.email,
    password: 'Password1!',
    agreement: true,
    username: 'Test_member',
    code: '123456',
  }
  const { passwordRules, validSignupPassword } = load('lib/auth-password.ts')
  assert.deepEqual(
    passwordRules.map((r) => r.label),
    [
      '8+ characters',
      '1 uppercase letter',
      '1 number',
      '1 symbol',
    ]
  )
  assert(validSignupPassword('PASSWORD1!')) // Lowercase is not an invented rule.
  assert(validSignupPassword('11111111A!'))
  assert(passwordRules.every((rule) => rule.test('11111111A!')))
  for (const password of ['Ab1!', 'password1!', 'Password!!', 'Password12'])
    assert(!validSignupPassword(password))
  for (const body of [
    { ...input, email: 'test@example.com' },
    { ...input, password: 'short' },
    { ...input, agreement: false },
  ]) {
    const before = calls.length
    assert.equal((await request('signup-code', body)).statusCode, 400)
    assert.equal(calls.length, before, 'Invalid signup must not reach Supabase')
  }
  assert.equal((await request('signup-code', input)).statusCode, 200)
  assert.equal(calls.at(-1).input.password, input.password)
  for (const password of ['11111111A!', ' Abcdefg1! ']) {
    assert.equal((await request('signup-code', { ...input, password })).statusCode, 200)
    assert.equal(calls.at(-1).input.password, password, 'SDK receives password unchanged')
  }
  assert.deepEqual(calls.at(-1).input.data, {
    username: input.username, display_name: input.username, marketplace_signup: true,
  }, 'Real SDK sends username in Auth user metadata')
  assert.equal((await request('resend-signup', input)).statusCode, 200)
  assert.equal(calls.at(-1).input.type, 'signup')
  const beforeVerification = calls.length
  passwordFailure = {status:422,body:{code:'same_password',msg:'New password should be different from the old password.'}}
  const verified = await request('verify-signup', input)
  assert.equal(verified.statusCode, 200)
  assert.deepEqual(calls.slice(beforeVerification).map(c=>[c.pathname,c.method]), [
    ['/auth/v1/verify','POST'], ['/auth/v1/user','GET'],
    ['/rest/v1/rpc/marketplace_confirm_username','POST'],
  ], 'Signup verifies OTP/user/profile, without password PUT or logout')
  passwordFailure = null
  assert(
    calls.some(
      (c) => c.pathname.endsWith('/verify') && c.input.type === 'email'
    )
  )
  assert(verified.headers.get('Set-Cookie').some((h) => /HttpOnly/i.test(h)))
  const restored = await request('session', {}, {
    cookie: verified.headers.get('Set-Cookie').map(h => h.split(';')[0]).join('; '),
  })
  assert.equal(restored.statusCode, 200)
  assert.deepEqual(restored.body.seller, { id: user.id, displayName: input.username },
    'OTP response cookies authenticate the existing success-session refresh')
  assert.equal((await request('sign-in', input)).statusCode, 200)
  const beforeLegacy = calls.length
  assert.equal((await request('email', { email: user.email })).statusCode, 200)
  assert.equal((await request('verify', { email: user.email, code: input.code })).statusCode, 200)
  assert.equal((await request('email', { email: 'unknown@uwo.ca' })).statusCode, 400)
  const legacyCalls = calls.slice(beforeLegacy)
  assert.equal(legacyCalls.filter(c => c.pathname.endsWith('/otp')).length, 2)
  assert(!legacyCalls.some(c => c.pathname.endsWith('/signup')), 'Legacy login cannot reach registration')
  assert(legacyCalls.some(c => c.pathname.endsWith('/verify') && c.input.type === 'email'))
  assert.equal((await request('recover', input)).statusCode, 200)
  const beforeRecovery = calls.length
  assert.equal((await request('reset-password', input)).statusCode, 200)
  assert(calls.slice(beforeRecovery).some(c=>c.pathname.endsWith('/user') && c.method==='PUT' && c.input.password===input.password), 'Recovery still writes the new password')
  passwordFailure = {status:422,body:{code:'same_password',msg:'New password should be different from the old password.'}}
  assert.match((await request('reset-password', input)).body.error,/Unable to save this password/)
  assert(calls.at(-1).pathname.endsWith('/logout'),'Recovery failure still signs out')
  passwordFailure = null
  assert(
    calls.some(
      (c) => c.pathname.endsWith('/verify') && c.input.type === 'recovery'
    )
  )
  assert.equal(
    (await request('verify-signup', { ...input, code: '' })).statusCode,
    400
  )
  failure = {
    status: 400,
    body: { code: 'otp_expired', msg: 'sensitive internals' },
  }
  const expired = await request('verify-signup', input)
  assert.match(expired.body.error, /incorrect or expired/)
  assert(!expired.body.error.includes('sensitive'))
  failure = {
    status: 400,
    body: { code: 'invalid_credentials', msg: 'sensitive internals' },
  }
  assert.match(
    (await request('sign-in', input)).body.error,
    /Check your email and password/
  )
  failure = {
    status: 422,
    body: { code: 'weak_password', msg: 'Provider password policy details' },
  }
  const weakPassword = await request('signup-code', { ...input, password: '11111111A!' })
  assert.equal(weakPassword.statusCode, 400)
  assert.equal(
    weakPassword.body.error,
    'Password does not meet the required security rules.'
  )
  failure = {
    status: 429,
    body: { code: 'over_email_send_rate_limit', msg: 'sensitive' },
  }
  assert.equal((await request('signup-code', input)).statusCode, 429)
  failure = {status:500,body:{code:'unexpected_failure',msg:`Database error saving new user ${input.email} ${input.password} ${input.code} ${token}`}}
  const diagnostics=[]
  const previousError=console.error
  let signupFailed
  console.error=(...args)=>diagnostics.push(args)
  try { signupFailed=await request('signup-code',input) }
  finally { console.error=previousError }
  assert.equal(signupFailed.statusCode,400)
  const diagnostic=diagnostics.find(d=>d[0]==='Marketplace signup provider failure')[1]
  assert.equal(diagnostic.providerStatus,500)
  assert.equal(diagnostic.providerCode,'unexpected_failure')
  assert.match(diagnostic.providerMessage,/Database error saving new user/)
  assert.equal(diagnostic.request.options.data.username,input.username)
  assert.deepEqual(diagnostic.passwordFacts, {
    length: input.password.length, hasUppercase: true,
    hasNumber: true, hasSymbol: true, hasLowercase: true,
  })
  for(const secret of [input.email,input.password,input.code,token]) assert(!JSON.stringify(diagnostic).includes(secret),'Provider diagnostic redacts secrets')
  assert(!signupFailed.body.error.includes('Database error'),'Raw provider details stay server-only')
  failure = null
  assert.equal(
    (await request('sign-in', input, { origin: 'https://other.example' }))
      .statusCode,
    403
  )
  console.log(
    'Auth modal API: password policy, Western/consent checks, signup metadata, existing-user-only legacy OTP, OTP session/profile without a second password write, unchanged recovery, cookies, redacted provider diagnostics and origin checks passed (mocked transport).'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
