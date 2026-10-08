/* global EventTarget, Event */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

function load(file, mocks = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (mocks[name]) return mocks[name]
      return name.startsWith('@/')
        ? load(path.resolve(name.slice(2) + '.ts'), mocks)
        : require(name)
    },
    module,
    module.exports
  )
  return module.exports
}
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
async function main() {
  const {
    createMessageRefreshQueue,
    mergeCanonicalMessages,
    fetchCanonicalCatchUp,
  } = load('lib/messages-reconciliation.ts')
  let count = 0,
    maximum = 0
  const jobs = [],
    releases = []
  const queue = createMessageRefreshQueue(
    (scope) =>
      new Promise((resolve) => {
        count++
        maximum = Math.max(maximum, count)
        jobs.push(scope)
        releases.push(() => {
          count--
          resolve()
        })
      }),
    5
  )
  for (let n = 0; n < 100; n++) {
    queue.dirty('buying')
    queue.dirty('selling')
    queue.dirty('history')
  }
  await delay(20)
  assert.equal(jobs.length, 2)
  assert.equal(maximum, 2)
  for (let n = 0; n < 100; n++) queue.dirty('buying')
  releases.shift()()
  await delay(20)
  releases.shift()()
  await delay(20)
  assert.equal(jobs.filter((scope) => scope === 'buying').length, 2)
  queue.stop()
  for (const release of releases) release()
  await delay(20)
  assert.equal(maximum, 2)
  const image = {
    id: 'message',
    conversationId: 'conversation',
    senderId: 'seller',
    createdAt: 'now',
    sequence: 1,
    type: 'IMAGE',
    images: [
      {
        id: 'image',
        previewUrl: 'new',
        expiresAt: '2030-01-01',
        name: 'image',
        size: 1,
        mimeType: 'image/png',
      },
    ],
  }
  const old = {
    ...image,
    images: [
      { ...image.images[0], previewUrl: 'old', expiresAt: '2029-01-01' },
    ],
  }
  assert.equal(mergeCanonicalMessages([image], [old])[0], image)
  assert.equal(mergeCanonicalMessages([image], [image]).length, 1)
  assert.throws(() =>
    mergeCanonicalMessages([image], [{ ...image, id: 'other' }])
  )

  const rows = Array.from({ length: 350 }, (_, index) => ({
    ...image,
    id: 'm' + (index + 1),
    sequence: index + 1,
    type: 'TEXT',
    content: 'fixture',
  }))
  const pageOf = (total) => async (before) => {
    const eligible = rows
      .slice(0, total)
      .filter((row) => !before || row.sequence < before)
    const messages = eligible.slice(-50)
    return {
      messages,
      nextBefore: eligible.length > 50 ? messages[0].sequence : null,
    }
  }
  const healed = await fetchCanonicalCatchUp(rows.slice(0, 20), pageOf(80))
  assert.equal(healed.pages, 2)
  assert.equal(healed.gap, false)
  assert.equal(healed.messages.length, 80)
  const capped = await fetchCanonicalCatchUp(rows.slice(0, 20), pageOf(350))
  assert.equal(capped.pages, 5)
  assert.equal(capped.gap, true)
  assert.equal(capped.messages.length, 250)
  assert.equal(capped.nextBefore, 101)
  const ref = 'pcaqxezdfxofysghssyo',
    userId = '11111111-1111-4111-8111-111111111111'
  const claims = {
    sub: userId,
    role: 'authenticated',
    iss: `https://${ref}.supabase.co/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 3600,
  }
  const jwt = (value) =>
    'header.' +
    Buffer.from(JSON.stringify(value)).toString('base64url') +
    '.signature'
  process.env.APP_ENV = 'staging'
  process.env.NEXT_PUBLIC_MESSAGES_ENV = 'staging'
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({ role: 'anon', ref })
  let verified = true,
    sessionReads = 0,
    value = claims
  const ListingApiError = load('lib/listing-validation.ts').ListingApiError
  const handler = load('pages/api/messages/realtime-session.ts', {
    '@/lib/listing-validation': { ListingApiError },
    '@/lib/supabase/server': {
      createMarketplaceClient: () => ({
        auth: {
          getSession: async () => {
            sessionReads++
            return {
              data: {
                session: { user: { id: userId }, access_token: jwt(value) },
              },
            }
          },
        },
      }),
    },
    '@/lib/server/marketplace-auth': {
      requireMarketplaceUser: async () => {
        if (!verified) throw new ListingApiError('Unauthorized', 401)
        return { id: userId }
      },
      requireSameOriginWrite: (req) => {
        if (req.headers['x-marketplace-request'] !== '1')
          throw new ListingApiError('Forbidden', 403)
      },
    },
  }).default
  const response = () => ({
    headers: {},
    statusCode: 200,
    setHeader(key, val) {
      this.headers[key] = val
    },
    status(code) {
      this.statusCode = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  })
  const request = { method: 'POST', headers: { 'x-marketplace-request': '1' } }
  let res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 200)
  assert.deepEqual(Object.keys(res.body).sort(), [
    'accessToken',
    'expiresAt',
    'userId',
  ])
  assert.match(res.headers['Cache-Control'], /no-store/)
  verified = false
  const reads = sessionReads
  res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 401)
  assert.equal(sessionReads, reads)
  verified = true
  value = { ...claims, role: 'service_role' }
  res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 401)
  value = { ...claims, exp: 0 }
  res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 401)
  value = { ...claims, sub: 'other' }
  res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 401)
  process.env.APP_ENV = 'production'
  res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 503)
  const productionRef = 'yzvchumzyonegujucyqs'
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${productionRef}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({
    role: 'anon',
    ref: productionRef,
  })
  value = { ...claims, iss: `https://${productionRef}.supabase.co/auth/v1` }
  res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 200)
  process.env.APP_ENV = 'staging'
  res = response()
  await handler(request, res)
  assert.equal(res.statusCode, 503)
  res = response()
  await handler({ ...request, method: 'GET' }, res)
  assert.equal(res.statusCode, 405)
  process.env.APP_ENV = 'staging'
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${ref}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({ role: 'anon', ref })

  const windowTarget = new EventTarget(),
    documentTarget = new EventTarget()
  global.window = windowTarget
  global.document = documentTarget
  documentTarget.visibilityState = 'visible'
  Object.defineProperty(global, 'navigator', {
    configurable: true,
    value: { onLine: true },
  })
  let active = 0,
    maxChannels = 0,
    signals = 0,
    recoveries = 0,
    callback
  const mockClient = {
    realtime: { setAuth: async () => {}, disconnect: () => {} },
    removeAllChannels: async () => {
      active = 0
    },
    channel(topic, config) {
      assert.equal(topic, `marketplace:messages:${userId}`)
      assert.equal(config.config.private, true)
      active++
      maxChannels = Math.max(maxChannels, active)
      return {
        on(_kind, _event, fn) {
          callback = fn
          return this
        },
        subscribe(fn) {
          fn('SUBSCRIBED')
          return this
        },
      }
    },
  }
  let requests = 0
  global.fetch = async (endpoint, options) => {
    requests++
    assert.equal(endpoint, '/api/messages/realtime-session')
    assert.equal(options.credentials, 'same-origin')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        accessToken: jwt(claims),
        expiresAt: claims.exp,
        userId,
      }),
    }
  }
  const { connectMessagesRealtime, parseMessagesSignal } = load(
    'lib/messages-realtime.ts',
    {
      '@supabase/supabase-js': {
        createClient: (_url, key, options) => {
          assert.equal(key, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
          assert.equal(typeof options.accessToken, 'function')
          assert.equal(
            options.realtime.sessionStorage.getItem('anything'),
            null
          )
          return mockClient
        },
      },
    }
  )
  assert.equal(parseMessagesSignal({ ...claims }), null)
  const stop = connectMessagesRealtime(
    userId,
    () => signals++,
    () => recoveries++,
    () => {}
  )
  await delay(20)
  assert.equal(active, 1)
  assert.equal(requests, 1)
  callback({
    payload: { conversationId: userId, scope: 'history', role: 'buying' },
  })
  assert.equal(signals, 1)
  stop()
  callback({
    payload: { conversationId: userId, scope: 'history', role: 'buying' },
  })
  await delay(10)
  assert.equal(signals, 1)
  assert.equal(active, 0)
  const stop2 = connectMessagesRealtime(
    userId,
    () => {},
    () => recoveries++,
    () => {}
  )
  await delay(20)
  windowTarget.dispatchEvent(new Event('marketplace-session-ended'))
  await delay(10)
  assert.equal(active, 0)
  stop2()
  assert.equal(maxChannels, 1)
  process.env.NEXT_PUBLIC_MESSAGES_ENV = 'production'
  const beforeMismatch = requests
  const mismatch = connectMessagesRealtime(
    userId,
    () => {},
    () => {},
    () => {}
  )
  await delay(20)
  assert.equal(requests, beforeMismatch)
  mismatch()
  process.env.NEXT_PUBLIC_SUPABASE_URL = `https://${productionRef}.supabase.co`
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = jwt({
    role: 'anon',
    ref: productionRef,
  })
  const prodStop = connectMessagesRealtime(
    userId,
    () => {},
    () => {},
    () => {}
  )
  await delay(20)
  assert.equal(active, 1)
  prodStop()
  await delay(10)
  assert.equal(active, 0)
  for (const designation of ['staging', 'unknown']) {
    process.env.NEXT_PUBLIC_MESSAGES_ENV = designation
    const before = requests
    const close = connectMessagesRealtime(
      userId,
      () => {},
      () => {},
      () => {}
    )
    await delay(10)
    assert.equal(requests, before)
    close()
  }
  console.log(
    'PASS: bounded/coalesced/trailing refresh; canonical dedupe/fresh leases/invariants; verified-only no-store user-token bridge; privileged/expired/mismatched session rejection; exact staging/production build-project guards; one private own-topic channel and logout/late-event cleanup; no network'
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
