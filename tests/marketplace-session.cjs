// SDK/cookie contract checks with a mocked Auth transport, not a live email test.
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
  process.env.NODE_ENV = 'production'
  const user = {
    id: '11111111-1111-4111-8111-111111111111',
    email: 'test@uwo.ca',
    email_confirmed_at: new Date().toISOString(),
    aud: 'authenticated',
    role: 'authenticated',
    app_metadata: { provider: 'email' },
    user_metadata: {},
  }
  const token = (expired = false) =>
    [
      Buffer.from('{"alg":"HS256"}').toString('base64url'),
      Buffer.from(
        JSON.stringify({
          sub: user.id,
          exp: Math.floor(Date.now() / 1000) + (expired ? -60 : 3600),
          iat: Math.floor(Date.now() / 1000) - 100,
          aud: 'authenticated',
        })
      ).toString('base64url'),
      Buffer.from('test-signature').toString('base64url'),
    ].join('.')
  let expired = false
  let refreshes = 0
  global.fetch = async (url, options = {}) => {
    const pathname = new URL(url).pathname
    const json = (data) =>
      new Response(JSON.stringify(data), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    if (pathname.endsWith('/otp')) return json({})
    if (pathname.endsWith('/verify'))
      return json({
        access_token: token(expired),
        refresh_token: 'test-refresh',
        token_type: 'bearer',
        expires_in: expired ? -60 : 3600,
        user,
      })
    if (pathname.endsWith('/token')) {
      refreshes++
      return json({
        access_token: token(),
        refresh_token: 'rotated-refresh',
        token_type: 'bearer',
        expires_in: 3600,
        user,
      })
    }
    if (pathname.endsWith('/user')) {
      assert(
        new Headers(options.headers).get('authorization')?.startsWith('Bearer ')
      )
      return json(user)
    }
    if (pathname.endsWith('/logout')) return new Response(null, { status: 204 })
    if (pathname.endsWith('/profiles'))
      return json({ id: user.id, display_name: 'Test member' })
    throw new Error('Unexpected Auth mock request: ' + url)
  }
  const { createMarketplaceClient } = load('lib/supabase/server.ts')
  const { requireMarketplaceUser, requireSameOriginWrite } = load(
    'lib/server/marketplace-auth.ts'
  )
  const cookies = new Map()
  function context() {
    const headers = new Map()
    return {
      req: {
        headers: {
          host: 'marketplace.test',
          cookie: Array.from(cookies, ([k, v]) => `${k}=${v}`).join('; '),
        },
      },
      res: {
        getHeader: (name) => headers.get(name),
        setHeader: (name, value) => headers.set(name, value),
      },
      headers,
    }
  }
  function remember(ctx) {
    const headers = ctx.headers.get('Set-Cookie') || []
    for (const header of headers) {
      assert(/HttpOnly/i.test(header))
      assert(/SameSite=Lax/i.test(header))
      assert(/Secure/i.test(header))
      const [name, value] = header.split(';')[0].split('=')
      if (/Max-Age=0/i.test(header)) cookies.delete(name)
      else cookies.set(name, value)
    }
    assert(/no-store/.test(ctx.headers.get('Cache-Control')))
  }
  await assert.rejects(
    requireMarketplaceUser(createMarketplaceClient(context())),
    (error) => error.status === 401
  )
  let ctx = context(),
    client = createMarketplaceClient(ctx)
  assert.equal(
    (await client.auth.signInWithOtp({ email: user.email })).error,
    null
  )
  assert.equal(
    (
      await client.auth.verifyOtp({
        email: user.email,
        token: '123456',
        type: 'email',
      })
    ).error,
    null
  )
  remember(ctx)
  assert(cookies.size > 0)
  ctx = context()
  client = createMarketplaceClient(ctx)
  assert.equal((await requireMarketplaceUser(client)).id, user.id)
  assert.equal((await client.auth.signOut({ scope: 'local' })).error, null)
  remember(ctx)
  assert.equal(cookies.size, 0)
  expired = true
  ctx = context()
  client = createMarketplaceClient(ctx)
  await client.auth.verifyOtp({
    email: user.email,
    token: '123456',
    type: 'email',
  })
  remember(ctx)
  ctx = context()
  client = createMarketplaceClient(ctx)
  await requireMarketplaceUser(client)
  remember(ctx)
  assert(refreshes > 0)
  user.email = 'outside@example.com'
  await assert.rejects(
    requireMarketplaceUser(client),
    (error) => error.status === 403
  )
  assert.throws(() =>
    requireSameOriginWrite({
      headers: {
        host: 'marketplace.test',
        origin: 'https://evil.test',
        'x-marketplace-request': '1',
      },
    })
  )
  assert.throws(() =>
    requireSameOriginWrite({ headers: { host: 'marketplace.test' } })
  )
  requireSameOriginWrite({
    headers: {
      host: 'marketplace.test',
      origin: 'https://marketplace.test',
      'x-marketplace-request': '1',
    },
  })
  console.log(
    'PASS: SDK OTP/session cookie contract, HttpOnly/Secure/SameSite, no-store, session reload, refresh rotation, sign-out cookie removal, verified-domain check, and cross-origin request rejection (Auth transport mocked).'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
