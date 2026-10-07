// Focused dispatcher/target protection tests. Hosted HTTP behavior is tested separately.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { spawnSync } = require('node:child_process')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
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
  const repository = load('lib/server/supabase-messages-repository.ts')
  const handler = load(
    'pages/api/messages/conversations/[[...segments]].ts'
  ).default
  let calls = 0
  global.fetch = async () => {
    calls++
    throw new Error('Network is prohibited in target-guard tests.')
  }
  const response = () => ({
    statusCode: 200,
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
    getHeader(key) {
      return this.headers[key]
    },
  })
  const targets = {
    staging: 'pcaqxezdfxofysghssyo',
    production: 'yzvchumzyonegujucyqs',
  }
  const jwt = (claims) =>
    [
      'eyJhbGciOiJIUzI1NiJ9',
      Buffer.from(JSON.stringify(claims)).toString('base64url'),
      'not-a-secret',
    ].join('.')
  for (const [designation, url, key] of [
    ['', `https://${targets.production}.supabase.co`, 'sb_publishable_unit'],
    ['unknown', `https://${targets.production}.supabase.co`, 'sb_publishable_unit'],
    ['toString', `https://${targets.production}.supabase.co`, 'sb_publishable_unit'],
    ['staging', `https://${targets.production}.supabase.co`, 'sb_publishable_unit'],
    ['production', `https://${targets.staging}.supabase.co`, 'sb_publishable_unit'],
    ['production', 'https://example.com', 'sb_publishable_unit'],
    ['production', '', 'sb_publishable_unit'],
    ['production', 'invalid', 'sb_publishable_unit'],
    ['production', `http://${targets.production}.supabase.co`, 'sb_publishable_unit'],
    ['production', `https://${targets.production}.supabase.co/path`, 'sb_publishable_unit'],
    ['production', `https://${targets.production}.supabase.co`, ''],
    ['production', `https://${targets.production}.supabase.co`, 'sb_secret_unit'],
    ['production', `https://${targets.production}.supabase.co`, jwt({ role: 'service_role', ref: targets.production })],
    ['production', `https://${targets.production}.supabase.co`, jwt({ role: 'anon', ref: targets.staging })],
    ['production', `https://${targets.production}.supabase.co`, 'bad.invalid.jwt'],
  ]) {
    process.env.APP_ENV = designation
    process.env.NEXT_PUBLIC_SUPABASE_URL = url
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key
    const res = response()
    await handler(
      { method: 'GET', query: { role: 'buying' }, headers: {}, cookies: {} },
      res
    )
    assert.equal(res.statusCode, 503)
    assert.match(res.body.error, /environment configuration/)
    assert.match(res.headers['Cache-Control'], /no-store/)
  }
  assert.equal(
    calls,
    0,
    'No Auth/database requests before environment protection'
  )
  for (const [designation, ref] of Object.entries(targets)) {
    process.env.APP_ENV = designation
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
    for (const key of ['sb_publishable_unit', jwt({ role: 'anon', ref })]) {
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key
      repository.requireMessagesEnvironment()
      const res = response()
      await handler(
        { method: 'GET', query: { role: 'buying' }, headers: {}, cookies: {} },
        res
      )
      assert.equal(res.statusCode, 401, 'Valid environment reaches normal session check')
    }
  }
  process.env.APP_ENV = 'staging'
  process.env.NEXT_PUBLIC_SUPABASE_URL =
    'https://pcaqxezdfxofysghssyo.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_unit'
  repository.requireMessagesEnvironment()
  for (const value of [
    null,
    [],
    'not an object',
    { at: 'invalid', id: '11111111-1111-4111-8111-111111111111' },
    { at: '2026-10-07T00:00:00Z', id: 'invalid' },
  ]) {
    assert.throws(
      () =>
        repository.conversationCursor(
          Buffer.from(JSON.stringify(value)).toString('base64url')
        ),
      (error) => error.status === 400
    )
  }
  const cursorBoundary = {
    at: '2026-10-07T00:00:00.000001+00:00',
    id: '11111111-1111-4111-8111-111111111111',
  }
  assert.deepEqual(
    repository.conversationCursor(
      Buffer.from(JSON.stringify(cursorBoundary)).toString('base64url')
    ),
    cursorBoundary
  )

  assert.throws(() => repository.messageUuid('sender-123'))
  assert.equal(
    repository.messageUuid('11111111-1111-4111-8111-111111111111'),
    '11111111-1111-4111-8111-111111111111'
  )
  for (const query of [
    { role: 'buying' },
    { role: 'invalid' },
    { segments: ['11111111-1111-4111-8111-111111111111', 'messages'] },
  ]) {
    const res = response()
    await handler({ method: 'GET', query, headers: {}, cookies: {} }, res)
    assert.equal(res.statusCode, 401)
  }
  const crossOrigin = response()
  await handler(
    {
      method: 'POST',
      query: {},
      headers: {
        'x-marketplace-request': '1',
        host: 'localhost:3100',
        origin: 'https://example.com',
      },
      body: {},
      cookies: {},
    },
    crossOrigin
  )
  assert.equal(crossOrigin.statusCode, 403)
  const unsupported = response()
  await handler(
    { method: 'DELETE', query: {}, headers: {}, cookies: {} },
    unsupported
  )
  assert.equal(unsupported.statusCode, 405)
  assert.equal(unsupported.headers.Allow, 'GET, POST')
  assert.equal(calls, 0)
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pwa-staging-guard-'))
  try {
    for (const [url, key] of [
      ['https://example.com', 'sb_publishable_test'],
      [
        'https://pcaqxezdfxofysghssyo.supabase.co',
        jwt({ role: 'service_role', ref: 'pcaqxezdfxofysghssyo' }),
      ],
      [
        'https://pcaqxezdfxofysghssyo.supabase.co',
        jwt({ role: 'anon', ref: 'wrong-project' }),
      ],
      ['https://pcaqxezdfxofysghssyo.supabase.co', ''],
    ]) {
      fs.writeFileSync(
        path.join(directory, '.env.staging.local'),
        `NEXT_PUBLIC_SUPABASE_URL=${url}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${key}\n`
      )
      const result = spawnSync(
        process.execPath,
        [path.resolve('scripts/dev-staging.cjs')],
        { cwd: directory, windowsHide: true, encoding: 'utf8' }
      )
      assert.notEqual(
        result.status,
        0,
        'Unsafe staging configuration must fail before starting Next'
      )
    }
  } finally {
    fs.unlinkSync(path.join(directory, '.env.staging.local'))
    fs.rmdirSync(directory)
  }
  console.log(
    'PASS: explicit staging/production accepted, unknown/mismatched/secret configuration blocked before network, UUIDs, unauthenticated routes, CSRF, methods, private no-store'
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
