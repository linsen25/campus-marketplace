// B04: actual Auth dispatcher, SSR cookies and Supabase SDK. All I/O is mocked.
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
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
async function main() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://127.0.0.1:54321'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'offline-public-key'
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'b04@uwo.ca',
    email_confirmed_at: '2026-10-01T00:00:00Z',
    app_metadata: {},
    user_metadata: {},
    aud: 'authenticated',
  }
  let password = 'Original1!',
    sequence = 0,
    mode = '',
    calls = [],
    logs = []
  const sessions = new Map()
  function session() {
    const id = String(++sequence)
    const access_token = [
      'eyJhbGciOiJIUzI1NiJ9',
      Buffer.from(
        JSON.stringify({
          sub: user.id,
          session_id: id,
          exp: Math.floor(Date.now() / 1000) + 3600,
        })
      ).toString('base64url'),
      'offline',
    ].join('.')
    const data = {
      access_token,
      refresh_token: 'offline-refresh-' + id,
      expires_in: 3600,
      token_type: 'bearer',
      user,
    }
    sessions.set(access_token, data)
    return data
  }
  const json = (data, status = 200) =>
    new Response(JSON.stringify(data), {
      status,
      headers: {
        'Content-Type': 'application/json',
        'X-Supabase-Api-Version': '2024-01-01',
      },
    })
  const fail = (code, status = 400) =>
    json({ code, msg: 'Private provider details must never escape' }, status)
  const originalError = console.error
  console.error = (...args) => logs.push(JSON.stringify(args))
  global.fetch = async (url, options = {}) => {
    const target = new URL(url)
    assert.equal(target.origin, 'http://127.0.0.1:54321', 'zero remote access')
    const body = options.body ? JSON.parse(options.body) : null
    const token = new Headers(options.headers)
      .get('authorization')
      ?.replace('Bearer ', '')
    calls.push({
      path: target.pathname,
      method: options.method,
      scope: target.searchParams.get('scope'),
      body,
      token,
    })
    if (target.pathname.endsWith('/token')) {
      if (
        body.grant_type === 'refresh_token' ||
        target.searchParams.get('grant_type') === 'refresh_token'
      ) {
        const found = [...sessions.values()].find(
          (s) => s.refresh_token === body.refresh_token
        )
        return found ? json(found) : fail('refresh_token_not_found')
      }
      return body.email === user.email && body.password === password
        ? json(session())
        : fail('invalid_credentials')
    }
    if (target.pathname.endsWith('/user') && options.method === 'GET')
      return sessions.has(token) && mode !== 'expired'
        ? json(user)
        : fail('session_not_found', 401)
    if (target.pathname.endsWith('/user') && options.method === 'PUT') {
      assert(sessions.has(token))
      assert.equal(
        body.current_password,
        password,
        'native current_password forwarded'
      )
      assert.deepEqual(
        Object.keys(body)
          .filter((k) => !k.startsWith('code_challenge'))
          .sort(),
        ['current_password', 'password']
      )
      if (mode === 'weak') return fail('weak_password', 422)
      if (mode === 'reauth') return fail('reauthentication_needed')
      if (mode === 'native-wrong') return fail('current_password_mismatch')
      password = body.password
      if (mode === 'lost-update') throw Error('offline transport failure')
      return json(user)
    }
    if (target.pathname.endsWith('/logout')) {
      const scope = target.searchParams.get('scope')
      if (scope === 'local' && mode === 'cleanup-failed')
        return fail('offline', 403)
      if (scope === 'others' && mode.startsWith('revoke-'))
        return fail('offline', Number(mode.split('-')[1]))
      if (scope === 'others')
        for (const key of sessions.keys()) {
          if (key !== token) sessions.delete(key)
        }
      else sessions.delete(token)
      return new Response(null, { status: 204 })
    }
    if (target.pathname.endsWith('/profiles'))
      return json({ id: user.id, display_name: 'B04' })
    throw Error('Unexpected Auth endpoint: ' + target.pathname)
  }
  const handler = load('pages/api/auth/[action].ts').default
  async function request(
    action,
    body,
    cookie = '',
    headers = {},
    method = 'POST'
  ) {
    const h = new Map()
    const res = {
      statusCode: 200,
      getHeader: (k) => h.get(k),
      setHeader: (k, v) => h.set(k, v),
      status(n) {
        this.statusCode = n
        return this
      },
      json(body) {
        this.body = body
        return this
      },
    }
    await handler(
      {
        method,
        query: { action },
        body,
        headers: {
          host: 'localhost:3100',
          origin: 'http://localhost:3100',
          'x-marketplace-request': '1',
          cookie,
          ...headers,
        },
      },
      res
    )
    return { ...res, headers: h }
  }
  const login = async (pass = password) => {
    const r = await request('sign-in', { email: user.email, password: pass })
    assert.equal(r.statusCode, 200)
    return r.headers
      .get('Set-Cookie')
      .map((v) => v.split(';')[0])
      .join('; ')
  }
  const input = (next = 'Replacement2!') => ({
    currentPassword: password,
    password: next,
    confirmation: next,
  })
  const change = (body, cookie, headers, method) =>
    request('change-password', body, cookie, headers, method)
  let cases = 0
  try {
    const a = await login()
    await login()
    const originalToken = [...sessions.keys()][0],
      otherToken = [...sessions.keys()][1]
    for (const [headers, status] of [
      [{ origin: 'https://evil.invalid' }, 403],
      [{ 'x-marketplace-request': '' }, 403],
    ]) {
      calls = []
      assert.equal((await change(input(), a, headers)).statusCode, status)
      assert.equal(calls.length, 0)
      cases++
    }
    assert.equal((await change(input(), a, {}, 'GET')).statusCode, 405)
    cases++
    assert.equal((await change(input(), '')).statusCode, 401)
    cases++
    mode = 'expired'
    assert.equal((await change(input(), a)).statusCode, 401)
    mode = ''
    cases++
    for (const bad of [
      { ...input(), currentPassword: '' },
      { ...input(), password: 'short', confirmation: 'short' },
      { ...input(), confirmation: 'mismatch' },
      { ...input(), userId: user.id },
      { ...input(), email: user.email },
    ]) {
      calls = []
      assert.equal((await change(bad, a)).statusCode, 400)
      assert(!calls.some((c) => c.method === 'PUT'))
      cases++
    }
    calls = []
    assert.equal(
      (await change({ ...input(), currentPassword: 'Incorrect1!' }, a))
        .statusCode,
      400
    )
    assert(!calls.some((c) => c.method === 'PUT'))
    cases++
    for (const failure of [
      'weak',
      'reauth',
      'native-wrong',
      'cleanup-failed',
    ]) {
      mode = failure
      const r = await change(input(), a)
      assert(r.statusCode >= 400)
      assert.equal(
        r.body.passwordUpdated,
        false,
        'known rejection is retryable even when cleanup is unavailable'
      )
      assert(!JSON.stringify(r.body).includes('Private provider'))
      cases++
    }
    mode = ''
    calls = []
    const success = await change(input(), a)
    assert.deepEqual(success.body, {
      passwordUpdated: true,
      otherSessionsRevoked: true,
    })
    assert(sessions.has(originalToken), 'original device retained')
    assert(!sessions.has(otherToken), 'other device refresh session revoked')
    assert.equal(sessions.size, 1, 'temporary proof session cleaned')
    const { createClient } = require('@supabase/supabase-js')
    const refreshClient = () =>
      createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
            detectSessionInUrl: false,
          },
        }
      )
    assert.equal(
      (
        await refreshClient().auth.refreshSession({
          refresh_token: sessions.get(originalToken).refresh_token,
        })
      ).error,
      null,
      'current device can refresh'
    )
    assert(
      (
        await refreshClient().auth.refreshSession({
          refresh_token: 'offline-refresh-2',
        })
      ).error,
      'other device refresh is rejected'
    )
    cases++
    assert.equal(
      await login('Original1!').catch(() => null),
      null,
      'old password rejected'
    )
    await login('Replacement2!')
    cases++
    // Every SDK-suppressed failure must remain a partial result, not success.
    for (const status of [401, 403, 404, 500]) {
      mode = ''
      const cookie = await login()
      mode = 'revoke-' + status
      const r = await change(input('Changed' + status + '!'), cookie)
      assert.equal(r.body.passwordUpdated, true)
      assert.equal(r.body.otherSessionsRevoked, false)
      assert.match(r.body.error, /password was changed/)
      cases++
    }
    mode = ''
    const cookie = await login()
    mode = 'lost-update'
    const uncertain = await change(input('Uncertain4!'), cookie)
    assert.equal(uncertain.body.passwordUpdated, null)
    assert.equal(uncertain.body.otherSessionsRevoked, false)
    cases++
    assert(
      !calls.some((c) => /recover|reauthenticate|verify|signup/.test(c.path)),
      'no OTP/email/recovery calls'
    )
    for (const secret of [
      'Original1!',
      'Replacement2!',
      'Uncertain4!',
      'offline-refresh-',
      'Private provider',
    ])
      assert(!logs.join('').includes(secret))
    assert.equal((await request('session', {}, a, {}, 'GET')).statusCode, 200)
    cases++
    console.log(
      `B04 Auth API: ${cases} offline cases passed; real SDK, native current_password, same-origin/identity/policy, proof cleanup, current session retained, others refresh revoked, partial/uncertain outcomes, no mail or remote I/O.`
    )
  } finally {
    console.error = originalError
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
