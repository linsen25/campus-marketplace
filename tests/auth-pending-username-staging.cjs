/* global fetch */
// Opt-in hosted STAGING ONLY. Credentials, cookies and OTPs stay in memory.
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { spawn } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const ref = 'pcaqxezdfxofysghssyo'
const url = `https://${ref}.supabase.co`
const base = 'http://localhost:3112'
const root = path.resolve('tests/artifacts/auth-pending-staging')
const run = crypto.randomBytes(5).toString('hex')
const users = []
let server,
  admin,
  publicKey,
  serial = 0,
  step = 'initial'
fs.mkdirSync(root, { recursive: true })
const originalFetch = global.fetch
global.fetch = (input, options) => {
  assert(
    [url, base].includes(
      new URL(typeof input === 'string' ? input : input.url || String(input))
        .origin
    )
  )
  return originalFetch(input, options)
}
function cli(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'cmd.exe',
      ['/d', '/c', 'npx.cmd', '--no-install', 'supabase', ...args],
      { windowsHide: true }
    )
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk
    })
    child.stderr.on('data', () => {})
    child.on('error', () => reject(new Error('Staging CLI launch failed')))
    child.on('close', (code) => {
      if (code)
        return reject(new Error('Staging CLI failed (details suppressed)'))
      try {
        resolve(JSON.parse(output.slice(output.indexOf('{'))))
      } catch {
        reject(new Error('Staging CLI response invalid'))
      }
    })
  })
}
async function query(sql) {
  const file = path.join(root, `query-${serial++}.sql`)
  fs.writeFileSync(file, sql)
  try {
    return await cli([
      'db',
      'query',
      '--linked',
      '--project-ref',
      ref,
      '--file',
      file,
    ])
  } finally {
    fs.unlinkSync(file)
  }
}
async function ok(promise) {
  const result = await promise
  if (result.error)
    throw new Error(
      `Hosted staging operation rejected (${
        result.error.code || result.error.status || 'provider'
      })`
    )
  return result.data
}
function pass(name) {
  console.log('PASS ' + name)
}
async function api(u, action, body, status = 200) {
  const response = await fetch(base + '/api/auth/' + action, {
    method: 'POST',
    headers: {
      Origin: base,
      'X-Marketplace-Request': '1',
      'Content-Type': 'application/json',
      Cookie: [...u.cookies].map(([n, v]) => n + '=' + v).join('; '),
    },
    body: JSON.stringify(body),
  })
  for (const header of response.headers.getSetCookie()) {
    const part = header.split(';')[0],
      at = part.indexOf('=')
    u.cookies.set(part.slice(0, at), part.slice(at + 1))
  }
  assert.equal(
    response.status,
    status,
    'API status (body suppressed): ' + action
  )
  assert.match(response.headers.get('cache-control') || '', /no-store/)
  const result = await response.json()
  assert(
    !JSON.stringify(result).includes(u.ticket || 'never-match-value'),
    'No pending capability in JSON'
  )
  return result
}
const body = (u, name = u.name, password = u.password) => ({
  email: u.email,
  username: name,
  password,
  agreement: true,
})
async function fixture(name) {
  const ticket = crypto.randomBytes(32).toString('hex')
  const u = {
    name: name + run,
    email: `authfix-${name.toLowerCase()}-${run}@uwo.ca`,
    password: 'Fixture-' + crypto.randomBytes(12).toString('hex') + 'A1!',
    ticket,
    cookies: new Map([['marketplace-pending-signup', ticket]]),
  }
  const result = await ok(
    admin.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: false,
      user_metadata: { username: u.name, pending_signup_ticket: ticket },
    })
  )
  u.id = result.user.id
  users.push(u)
  return u
}
async function otp(u) {
  const data = await ok(
    admin.auth.admin.generateLink({
      type: 'signup',
      email: u.email,
      password: u.password,
    })
  )
  return data.properties.email_otp
}
async function profile(u) {
  const rows = await query(
    `select username from public.profiles where id='${u.id}';`
  )
  return rows.rows[0].username
}
async function main() {
  try {
    step = 'staging credentials'
    const keys = (await cli(['projects', 'api-keys', '--project-ref', ref]))
      .keys
    publicKey = keys.find((k) => k.name === 'anon').api_key
    const secret = keys.find((k) => k.name === 'service_role').api_key
    for (const [key, role] of [
      [publicKey, 'anon'],
      [secret, 'service_role'],
    ]) {
      const claims = JSON.parse(
        Buffer.from(key.split('.')[1], 'base64url').toString()
      )
      assert.equal(claims.ref, ref)
      assert.equal(claims.role, role)
    }
    admin = createClient(url, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    })
    step = 'isolated server readiness'
    server = spawn(
      process.execPath,
      [
        '-e',
        `const next=require('next');const http=require('http');const config=require('./next.config.js');config.distDir='tests/artifacts/auth-pending-staging/runtime';const app=next({dev:true,conf:config});app.prepare().then(()=>http.createServer(app.getRequestHandler()).listen(3112,'127.0.0.1'));`,
      ],
      {
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          APP_ENV: 'staging',
          NODE_ENV: 'development',
          NEXT_PUBLIC_SUPABASE_URL: url,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: publicKey,
          SUPABASE_SERVICE_ROLE_KEY: secret,
        },
      }
    )
    let ready = false
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(base + '/api/auth/session')).status === 200) {
          ready = true
          break
        }
      } catch {
        /* Server is still starting. */
      }
      await new Promise((r) => setTimeout(r, 500))
    }
    assert(ready, 'Isolated staging app starts')
    step = 'signup API'
    const a = {
      name: 'StartA' + run,
      email: `authfix-signup-${run}@uwo.ca`,
      password: 'Signup-' + crypto.randomBytes(12).toString('hex') + 'A1!',
      cookies: new Map(),
    }
    if (process.env.AUTH_STAGING_ADMIN_FIXTURE === '1') {
      const f = await fixture('StartA')
      Object.assign(a, f)
    } else {
      await api(a, 'signup-code', body(a))
      a.ticket = a.cookies.get('marketplace-pending-signup')
    }
    step = 'pending cookie issuance'
    assert(
      /^[0-9a-f]{64}$/.test(a.ticket || ''),
      'HttpOnly pending cookie issued'
    )
    const found = await query(
      `select id,raw_user_meta_data ? 'pending_signup_ticket' as leaked from auth.users where email='${a.email}';`
    )
    a.id = found.rows[0].id
    if (!users.some((u) => u.id === a.id)) users.push(a)
    step = 'persisted metadata redaction'
    assert.equal(found.rows[0].leaked, false)
    step = 'pending correction tests'
    const oldCode = await otp(a)
    const taken = await fixture('Taken')
    await api(a, 'correct-signup-username', body(a, taken.name), 409)
    assert.equal(await profile(a), a.name)
    const intact = await query(
      `select email_confirmed_at is null as pending,confirmation_token<>'' as code_intact from auth.users where id='${a.id}';`
    )
    assert.equal(intact.rows[0].pending, true)
    assert.equal(intact.rows[0].code_intact, true)
    pass('C: collision rejects and original pending state/code remain intact')
    const corrected = 'CorrectB' + run
    const edited = 'Edited-' + crypto.randomBytes(12).toString('hex') + 'B2!'
    await api(a, 'correct-signup-username', body(a, corrected, edited))
    assert.equal(await profile(a), corrected)
    const availabilityClient = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const available = await ok(
      availabilityClient.rpc('marketplace_username_available', {
        candidate: a.name,
      })
    )
    assert.equal(available, true)
    pass('B: old pending username released')
    const stale = await admin.auth.verifyOtp({
      email: a.email,
      token: oldCode,
      type: 'email',
    })
    assert(stale.error, 'Actual GoTrue rejects the old OTP after correction')
    await api(
      a,
      'verify-signup',
      { ...body(a, a.name, edited), code: oldCode, updateSignupPassword: true },
      400
    )
    pass('D: actual old OTP and stale application verification path reject')
    // Observe the normal email resend throttle instead of disabling it.
    if (process.env.AUTH_STAGING_ADMIN_FIXTURE !== '1')
      console.log(
        'Waiting for existing hosted resend cooldown; no Auth settings changed.'
      )
    if (process.env.AUTH_STAGING_ADMIN_FIXTURE !== '1')
      await new Promise((r) => setTimeout(r, 61000))
    if (process.env.AUTH_STAGING_ADMIN_FIXTURE !== '1')
      await api(a, 'resend-signup', body(a, corrected, edited))
    // Admin test helper retrieves a fresh valid OTP without mailbox credentials.
    // This generates another fresh token; it does NOT inspect delivered email.
    const fresh = await otp(a)
    await api(a, 'verify-signup', {
      ...body(a, corrected, edited),
      code: fresh,
      updateSignupPassword: true,
    })
    assert.equal(await profile(a), corrected)
    const userClient = createClient(url, publicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    await ok(
      userClient.auth.signInWithPassword({ email: a.email, password: edited })
    )
    assert(
      (
        await userClient.auth.signInWithPassword({
          email: a.email,
          password: a.password,
        })
      ).error
    )
    pass(
      'A/G: normal signup, correction, fresh code, verified profile and edited password'
    )
    const denied = await userClient.rpc('marketplace_change_username', {
      candidate: 'Rename' + run,
    })
    assert(denied.error && denied.error.code === 'P0001')
    assert(
      (
        await admin.rpc('marketplace_correct_pending_username', {
          p_ticket: a.ticket,
          p_email: a.email,
          p_username: 'Bypass' + run,
        })
      ).error
    )
    assert(
      (
        await userClient.rpc('marketplace_correct_pending_username', {
          p_ticket: a.ticket,
          p_email: a.email,
          p_username: 'Bypass' + run,
        })
      ).error
    )
    pass(
      'E: verified cooldown and service-RPC pending-state boundary preserved'
    )
    const raceA = await fixture('RaceA'),
      raceB = await fixture('RaceB')
    const race = await Promise.all(
      [raceA, raceB].map((u) =>
        admin.rpc('marketplace_correct_pending_username', {
          p_ticket: u.ticket,
          p_email: u.email,
          p_username: 'Race' + run,
        })
      )
    )
    assert.equal(race.filter((r) => !r.error).length, 1)
    assert.equal(race.filter((r) => r.error?.code === '23505').length, 1)
    const wrong = await admin.rpc('marketplace_correct_pending_username', {
      p_ticket: raceA.ticket,
      p_email: raceB.email,
      p_username: 'Hijack' + run,
    })
    assert(wrong.error)
    pass('F: hosted concurrent claims preserve uniqueness and ownership')
    const counts = await query(
      `select (select count(*)::int from auth.users where id in (${users
        .map((u) => "'" + u.id + "'")
        .join(
          ','
        )})) as users,(select count(*)::int from public.profiles where id in (${users
        .map((u) => "'" + u.id + "'")
        .join(',')})) as profiles;`
    )
    assert.equal(counts.rows[0].users, users.length)
    assert.equal(counts.rows[0].profiles, users.length)
    pass('H: no duplicate Auth users/profile rows')
    const history = await query(
      'select version from supabase_migrations.schema_migrations order by version;'
    )
    assert(history.rows.some((r) => r.version === '202610090001'))
    pass('staging migration history confirmed')
  } finally {
    try {
      if (admin) {
        const discovered = await query(
          `select id from auth.users where email like 'authfix-%-${run}@uwo.ca';`
        )
        for (const row of discovered.rows)
          if (!users.some((u) => u.id === row.id)) users.push({ id: row.id })
        for (const u of users) await ok(admin.auth.admin.deleteUser(u.id))
        if (users.length) {
          const ids = users.map((u) => "'" + u.id + "'").join(',')
          const remaining = await query(
            `select (select count(*)::int from auth.users where id in (${ids}))+(select count(*)::int from public.profiles where id in (${ids}))+(select count(*)::int from marketplace_private.pending_signup_controls where user_id in (${ids})) as remaining;`
          )
          assert.equal(remaining.rows[0].remaining, 0)
        }
        pass('disposable staging users/profiles/capabilities removed')
      }
    } finally {
      if (server) server.kill()
    }
  }
}
main().catch((e) => {
  console.error(
    'FAIL hosted pending signup check at ' +
      step +
      '; ' +
      (e instanceof assert.AssertionError
        ? 'assertion ' +
          e.operator +
          ' numeric status ' +
          (typeof e.actual === 'number' ? e.actual : 'suppressed')
        : /^Hosted staging operation rejected/.test(e.message)
        ? e.message
        : 'details suppressed')
  )
  process.exitCode = 1
})
