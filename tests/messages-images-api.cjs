// Local transport/authorization tests. No database or Storage connections.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { Blob } = require('node:buffer')
const { Readable } = require('node:stream')
const { EventEmitter } = require('node:events')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  cache.set(full, module.exports)
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
  return module.exports
}
const ref = 'pcaqxezdfxofysghssyo'
const jwt = (claims) =>
  [
    'unit',
    Buffer.from(JSON.stringify(claims)).toString('base64url'),
    'not-a-real-key',
  ].join('.')
const res = () =>
  Object.assign(new EventEmitter(), {
    code: 200,
    headers: {},
    setHeader(name, value) {
      this.headers[name] = value
    },
    getHeader(name) {
      return this.headers[name]
    },
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  })
async function main() {
  let network = 0
  global.fetch = () => {
    network++
    throw new Error('No network in unit tests')
  }
  process.env.APP_ENV = 'staging'
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'sb_publishable_unit'
  const storage = load('lib/server/chat-image-storage.ts')
  for (const key of [
    '',
    'sb_publishable_unit',
    'sb_secret_unit',
    jwt({ role: 'anon', ref }),
    jwt({ role: 'service_role', ref: 'wrong' }),
  ]) {
    process.env.SUPABASE_SERVICE_ROLE_KEY = key
    assert.throws(() => storage.requireImageEnvironment())
    assert.equal(storage.imageSendingEnabled(), false)
  }
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'service_role', ref })
  assert(storage.imageSendingEnabled())
  for (const [designation, project] of [
    ['staging', ref],
    ['production', 'yzvchumzyonegujucyqs'],
  ]) {
    const other = project === ref ? 'yzvchumzyonegujucyqs' : ref
    process.env.APP_ENV = designation
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${project}.supabase.co`
    process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({
      role: 'service_role',
      ref: project,
    })
    assert.equal(storage.imageSendingEnabled(), true)
    assert.equal(
      storage.createChatStorage().supabaseUrl,
      `https://${project}.supabase.co`
    )
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${other}.supabase.co`
    assert.throws(
      () => storage.createChatStorage(),
      (error) => error.status === 503
    )
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${project}.supabase.co`
    for (const invalid of [
      '',
      jwt({ role: 'anon', ref: project }),
      jwt({ role: 'service_role', ref: other }),
    ]) {
      process.env.SUPABASE_SERVICE_ROLE_KEY = invalid
      assert.throws(
        () => storage.createChatStorage(),
        (error) => error.status === 503
      )
      assert.equal(storage.imageSendingEnabled(), false)
    }
  }
  process.env.APP_ENV = 'unknown'
  assert.throws(
    () => storage.requireImageEnvironment(),
    (error) => error.status === 503
  )
  process.env.APP_ENV = 'staging'
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'service_role', ref })
  const route = load('pages/api/messages/images/[[...segments]].ts').default
  const uploadRoute = load(
    'pages/api/messages/image-upload/[submissionId]/[imageId].ts'
  ).default
  const id = '11111111-1111-4111-8111-111111111111'
  for (const [designation, project] of [
    ['staging', ref],
    ['production', 'yzvchumzyonegujucyqs'],
  ]) {
    process.env.APP_ENV = designation
    process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${project}.supabase.co`
    process.env.SUPABASE_SERVICE_ROLE_KEY = ''
    const unavailable = res()
    await route(
      { method: 'GET', query: { segments: [id] }, headers: {} },
      unavailable
    )
    assert.equal(unavailable.code, 503)
    assert.equal(
      unavailable.body.error,
      'Private image storage is not configured.'
    )
    assert.equal(network, 0)
  }
  process.env.APP_ENV = 'staging'
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
  process.env.SUPABASE_SERVICE_ROLE_KEY = jwt({ role: 'service_role', ref })
  for (const [method, segments, headers, expected] of [
    ['POST', [id, 'prepare'], {}, 403],
    ['DELETE', [id, 'prepare'], {}, 405],
    ['GET', [id], {}, 401],
    [
      'POST',
      [id, 'prepare'],
      {
        'x-marketplace-request': '1',
        host: 'localhost',
        origin: 'https://attacker.test',
      },
      403,
    ],
  ]) {
    const response = res()
    await route({ method, query: { segments }, headers }, response)
    assert.equal(response.code, expected)
    assert.match(response.headers['Cache-Control'], /no-store/)
  }
  const anonymous = Readable.from([Buffer.from('unauthenticated bytes')])
  anonymous.method = 'POST'
  anonymous.headers = { 'x-marketplace-request': '1' }
  anonymous.query = { submissionId: id, imageId: id }
  const response = res()
  await uploadRoute(anonymous, response)
  assert.equal(response.code, 401)
  assert.equal(anonymous.readableDidRead, false)
  assert.equal(network, 0)
  const service = load('lib/server/message-image-service.ts')
  const bytes = Buffer.from([255, 216, 255]),
    imageId = '22222222-2222-4222-8222-222222222222'
  const slot = {
    id: imageId,
    position: 1,
    storage_path: `${id}/${id}/${imageId}`,
    mime_type: 'image/jpeg',
    size_bytes: 3,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  }
  const submission = {
    id,
    conversation_id: id,
    sender_id: id,
    state: 'pending',
    expires_at: new Date(Date.now() + 60000).toISOString(),
    manifest: [slot],
  }
  let allowed = true,
    writes = 0,
    receipts = 0,
    privileged = 0
  const client = {
    auth: {
      getUser: async () => ({
        data: {
          user: { id, email: 'unit@uwo.ca', email_confirmed_at: '2026-01-01' },
        },
        error: null,
      }),
    },
    from(table) {
      return {
        select() {
          return this
        },
        eq() {
          return this
        },
        in() {
          return this
        },
        async maybeSingle() {
          return {
            data:
              table === 'image_message_submissions'
                ? allowed
                  ? submission
                  : null
                : { id },
            error: null,
          }
        },
      }
    },
  }
  const file = {
    async upload(name, body, options) {
      writes++
      assert.equal(name, slot.storage_path)
      assert.equal(options.upsert, false)
      assert.deepEqual(body, bytes)
      return { data: null, error: { statusCode: '409' } }
    },
    async info() {
      return { data: { id, contentType: slot.mime_type, size: 3 }, error: null }
    },
    async download() {
      return { data: new Blob([bytes]), error: null }
    },
  }
  storage.createChatStorage = () => {
    privileged++
    return {
      storage: {
        from(name) {
          assert.equal(name, 'chat-images')
          return file
        },
      },
      async rpc(name, args) {
        receipts++
        assert.equal(name, 'marketplace_record_verified_chat_image')
        assert.equal(args.p_actor_id, id)
        assert.equal(args.p_sha256, slot.sha256)
        return { error: null }
      },
    }
  }
  const request = (body) => {
    const req = Readable.from([body])
    req.headers = {
      'content-type': 'image/jpeg',
      'content-length': String(body.length),
    }
    return req
  }
  allowed = false
  const outsider = request(bytes)
  await assert.rejects(
    service.uploadMessageImage(
      client,
      outsider,
      id,
      imageId,
      new AbortController()
    ),
    /not found/
  )
  assert.equal(privileged, 0)
  assert.equal(outsider.readableDidRead, false)
  allowed = true
  await assert.rejects(
    service.uploadMessageImage(
      client,
      request(Buffer.from([255, 216, 0])),
      id,
      imageId,
      new AbortController()
    ),
    /bytes do not match/
  )
  assert.equal(writes, 0)
  assert.equal(receipts, 0)
  const oversized = request(bytes)
  oversized.headers['content-length'] = '3145729'
  await assert.rejects(
    service.uploadMessageImage(
      client,
      oversized,
      id,
      imageId,
      new AbortController()
    ),
    (error) => error.status === 413
  )
  assert.equal(oversized.readableDidRead, false)
  const wrongMime = request(bytes)
  wrongMime.headers['content-type'] = 'image/gif'
  await assert.rejects(
    service.uploadMessageImage(
      client,
      wrongMime,
      id,
      imageId,
      new AbortController()
    ),
    (error) => error.status === 415
  )
  assert.equal(wrongMime.readableDidRead, false)
  const stalled = new Readable({
    read() {
      return undefined
    },
  })
  stalled.headers = { 'content-type': 'image/jpeg', 'content-length': '3' }
  const deadline = new AbortController()
  const abortTimer = setTimeout(() => deadline.abort(), 10)
  await assert.rejects(
    service.uploadMessageImage(client, stalled, id, imageId, deadline),
    (error) => error.status === 503
  )
  clearTimeout(abortTimer)
  stalled.destroy()
  const uploaded = await service.uploadMessageImage(
    client,
    request(bytes),
    id,
    imageId,
    new AbortController()
  )
  assert.equal(uploaded.verified, true)
  assert.equal(writes, 1)
  assert.equal(receipts, 1)
  const vm = require('node:vm')
  for (const [serverKey, accepted] of [
    ['', true],
    [jwt({ role: 'service_role', ref }), true],
    [jwt({ role: 'service_role', ref: 'wrong' }), false],
  ]) {
    let launched = 0
    const launcherRequire = (name) =>
      name === 'node:fs'
        ? {
            readFileSync: () =>
              'NEXT_PUBLIC_SUPABASE_URL=https://' +
              ref +
              '.supabase.co\nNEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_unit',
          }
        : name === 'node:child_process'
        ? {
            spawn(executable, args, options) {
              launched++
              assert.equal(options.env.APP_ENV, 'staging')
              assert.equal(options.env.SUPABASE_SERVICE_ROLE_KEY, serverKey)
              return {
                on() {
                  return undefined
                },
              }
            },
          }
        : require(name)
    launcherRequire.resolve = require.resolve
    const runLauncher = () =>
      vm.runInNewContext(fs.readFileSync('scripts/dev-staging.cjs', 'utf8'), {
        require: launcherRequire,
        process: {
          env: { SUPABASE_SERVICE_ROLE_KEY: serverKey },
          argv: [],
          execPath: process.execPath,
        },
        console: {
          log() {
            return undefined
          },
        },
        Buffer,
      })
    if (accepted) runLauncher()
    else assert.throws(runLauncher)
    assert.equal(launched, accepted ? 1 : 0)
  }
  console.log(
    'PASS: IMAGE staging/production project-bound server guard, cross-project/unknown/missing/wrong-role rejection before network, safe missing-key API 503, methods/CSRF/no-store, unauthenticated/outsider before body/privileged access, actual byte hash rejection and immutable duplicate reconciliation with server receipt; no network'
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
