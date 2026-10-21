// Opt-in B06 acceptance: current local app, explicit Staging, unique disposable data.
/* global fetch, window, document, Request, EventTarget, Event, atob, Navigator, innerWidth */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  { spawn } = require('node:child_process'),
  sharp = require('sharp')
const { createClient } = require('@supabase/supabase-js')
const {
  environment,
  query: sql,
  q,
  ids,
} = require('../scripts/v2-maintenance-staging.cjs')
const env = environment(),
  ref = 'pcaqxezdfxofysghssyo',
  url = `https://${ref}.supabase.co`,
  base = 'http://localhost:3116'
assert.equal(process.env.B06_STAGING_WRITE_APPROVED, '1')
const run = crypto.randomUUID(),
  folder = path.resolve('tests/artifacts/b06-live-' + run)
fs.mkdirSync(folder, { recursive: true })
const results = [],
  users = [],
  listingIds = [],
  conversationIds = [],
  sockets = [],
  chatPaths = new Set()
const topic = (id) => `marketplace:messages:${id}`
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
let admin,
  server,
  browser,
  failure,
  cleanupComplete = false
const query = async (text) => ({ rows: sql(text) })
function save() {
  fs.writeFileSync(
    path.join(folder, 'result.json'),
    JSON.stringify(
      {
        run,
        projectRef: ref,
        results,
        users: users.map((u) => ({ id: u.id, cleaned: !!u.cleaned })),
        listingIds,
        conversationIds,
        chatPaths: [...chatPaths],
        failure,
        cleanupComplete,
      },
      null,
      2
    )
  )
}
const nativeFetch = global.fetch
global.fetch = (input, init = {}) => {
  const u = new URL(input instanceof Request ? input.url : String(input))
  assert([url, base].includes(u.origin), 'Only pinned Staging/local app')
  assert(
    !/\/(signup|otp|recover|resend|invite|generate_link|reauthenticate)$/.test(
      u.pathname
    ),
    'Mail endpoints forbidden'
  )
  if (u.pathname === '/auth/v1/admin/users' && init.method === 'POST') {
    const body = JSON.parse(init.body)
    assert(body.email.startsWith('b06-' + run))
    assert.equal(body.email_confirm, true)
  }
  if (
    u.pathname.startsWith('/auth/v1/admin/users/') &&
    init.method === 'DELETE'
  )
    assert(users.some((x) => u.pathname.endsWith('/' + x.id)))
  return nativeFetch(input, init)
}
// Common API/SDK helpers follow; no shared service mutations or fixtures.
async function ok(promise, label) {
  const response = await promise
  if (response.error)
    throw new Error(
      `${label}: rejected (${
        response.error.code || response.error.status || 'provider'
      })`
    )
  return response.data
}
function pass(test, detail = {}) {
  const entry = { test, result: 'PASS', ...detail }
  results.push(entry)
  save()
  console.log(JSON.stringify(entry))
}
async function api(
  user,
  endpoint,
  data,
  method = data === undefined ? 'GET' : 'POST',
  raw = false,
  expected = 200
) {
  const response = await fetch(base + endpoint, {
    method,
    headers: {
      Origin: base,
      'X-Marketplace-Request': '1',
      'Content-Type': raw ? 'image/jpeg' : 'application/json',
      Cookie: [...user.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
    },
    ...(data === undefined ? {} : { body: raw ? data : JSON.stringify(data) }),
  })
  for (const header of response.headers.getSetCookie()) {
    const item = header.split(';')[0],
      at = item.indexOf('=')
    user.cookies.set(item.slice(0, at), item.slice(at + 1))
  }
  assert.equal(
    response.status,
    expected,
    `${endpoint}: HTTP status (body suppressed)`
  )
  assert.match(response.headers.get('cache-control') || '', /no-store/)
  return response.json().catch(() => null)
}
const messages = '/api/messages/conversations'
async function text(user, id, label) {
  return api(user, `${messages}/${id}/messages`, {
    type: 'TEXT',
    content: `B06 ${label}`,
    clientMessageId: crypto.randomUUID(),
  })
}
async function image(user, id, jpeg) {
  const submission = await api(user, `/api/messages/images/${id}/prepare`, {
    clientMessageId: crypto.randomUUID(),
    images: [
      {
        original_name: 'staging-fixture.jpg',
        mime_type: 'image/jpeg',
        size_bytes: jpeg.length,
        sha256: crypto.createHash('sha256').update(jpeg).digest('hex'),
      },
    ],
  })
  const paths = await query(
    `select storage_path from public.image_message_submissions s cross join lateral jsonb_to_recordset(s.manifest) as x(storage_path text) where s.id=${q(
      submission.id
    )};`
  )
  paths.rows.forEach((row) => chatPaths.add(row.storage_path))
  await api(
    user,
    `/api/messages/image-upload/${submission.id}/${submission.manifest[0].id}`,
    jpeg,
    'POST',
    true
  )
  const result = await api(
    user,
    `/api/messages/images/${submission.id}/finalize`,
    {}
  )
  assert.equal(result.type, 'IMAGE')
  assert.equal(result.images.length, 1)
  const bytes = await fetch(result.images[0].previewUrl)
  assert.equal(bytes.status, 200)
  assert(
    (await sharp(Buffer.from(await bytes.arrayBuffer())).metadata()).width > 0
  )
  return result
}
async function listen(
  user,
  destination = topic(user.id),
  privateChannel = true,
  expected = 'SUBSCRIBED',
  tokenOverride
) {
  const holder = {
    token: tokenOverride === undefined ? user.token : tokenOverride,
    events: [],
    states: [],
    rejected: false,
  }
  holder.client = createClient(url, user.publicKey, {
    accessToken: async () => holder.token,
    realtime: { timeout: 10000, heartbeatIntervalMs: 10000 },
  })
  assert.equal(
    new URL(holder.client.realtime.endPoint).hostname,
    `${ref}.supabase.co`,
    'WebSocket must stay on staging'
  )
  sockets.push(holder)
  await holder.client.realtime.setAuth()
  holder.channel = holder.client
    .channel(destination, {
      config: { private: privateChannel, broadcast: { ack: true } },
    })
    .on('broadcast', { event: '*' }, (event) => {
      holder.events.push(event)
      if (expected !== 'SUBSCRIBED') holder.rejected = true
    })
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('WebSocket join exceeded bounded deadline')),
      16000
    )
    holder.channel.subscribe((status, error) => {
      holder.states.push(status)
      if (
        status === 'SUBSCRIBED' ||
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT'
      ) {
        clearTimeout(timer)
        if (
          expected === 'PUBLIC_PROBE'
            ? status !== 'TIMED_OUT'
            : expected === 'SUBSCRIBED'
            ? status === expected
            : status === 'CHANNEL_ERROR'
        )
          resolve()
        else {
          const detail = String(error?.message || '')
            .split(holder.token || '[none]')
            .join('[token]')
            .split(user.publicKey)
            .join('[key]')
            .replace(
              /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
              '[token]'
            )
            .replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9-]{23,}/gi, '[id]')
          reject(
            new Error(
              `Unexpected WebSocket join status: ${status}; ${detail.slice(
                0,
                300
              )}`
            )
          )
        }
      }
    })
  })
  return holder
}
async function close(holder) {
  if (!holder || holder.closed) return
  holder.closed = true
  await holder.client.removeAllChannels()
  holder.client.realtime.disconnect()
  holder.token = null
}
async function delivered(buyer, seller, outsider, id, previous, label) {
  const deadline = Date.now() + 12000
  while (Date.now() < deadline) {
    if (
      [buyer, seller].every((holder, index) =>
        holder.events
          .slice(previous[index])
          .some(
            (x) =>
              x.payload.conversationId === id && x.payload.scope === 'history'
          )
      )
    )
      break
    await wait(100)
  }
  for (const [index, holder] of [buyer, seller].entries()) {
    const events = holder.events
      .slice(previous[index])
      .filter((x) => x.payload.conversationId === id)
    assert(
      events.some((x) => x.payload.scope === 'history'),
      `${label}: message invalidation`
    )
    assert(
      events.some((x) => x.payload.scope === 'list'),
      `${label}: list invalidation`
    )
    for (const event of events) {
      assert.equal(event.event, 'messages_changed')
      // Hosted realtime.send adds its notification UUID; it is transport metadata.
      assert.deepEqual(Object.keys(event.payload).sort(), [
        'conversationId',
        'id',
        'role',
        'scope',
      ])
      assert.match(event.payload.id, /^[a-f0-9-]{36}$/i)
      assert.equal(event.payload.role, index === 0 ? 'buying' : 'selling')
      assert(['history', 'list'].includes(event.payload.scope))
    }
  }
  assert.equal(
    outsider.events.length,
    0,
    'Unrelated own topic must remain silent'
  )
  pass(label, {
    buyerSignals: buyer.events.length - previous[0],
    sellerSignals: seller.events.length - previous[1],
    outsiderSignals: 0,
    minimalPayload: true,
  })
}
async function startServer() {
  // All secrets enter only the child process environment. No default linked CLI.
  const launch = async () => {
    process.env.NODE_ENV = 'development'
    process.env.NEXT_TELEMETRY_DISABLED = '1'
    const origin = 'https://pcaqxezdfxofysghssyo.supabase.co'
    if (
      process.env.APP_ENV !== 'staging' ||
      process.env.NEXT_PUBLIC_SUPABASE_URL !== origin
    )
      throw Error('Wrong target')
    const original = global.fetch
    global.fetch = (input, init) => {
      const target = new URL(
        typeof input === 'string' ? input : input.url || String(input)
      )
      if (target.origin !== origin)
        throw Error('Non-staging server request blocked')
      if (
        /\/(signup|otp|recover|resend|invite|generate_link|reauthenticate)$/.test(
          target.pathname
        )
      )
        throw Error('Mail blocked')
      return original(input, init)
    }
    const config = await require('next/dist/server/config').default(
      require('next/constants').PHASE_DEVELOPMENT_SERVER,
      process.cwd()
    )
    config.distDir = process.env.B06_DIST
    const app = require('next')({
      dev: true,
      dir: process.cwd(),
      conf: config,
      hostname: 'localhost',
      port: 3116,
    })
    await app.prepare()
    require('node:http')
      .createServer(app.getRequestHandler())
      .listen(3116, () => console.log('B06_READY'))
  }
  let ready = false
  server = spawn(
    process.execPath,
    [
      '--openssl-legacy-provider',
      '-e',
      `(${launch.toString()})().catch(()=>{console.error('B06_SERVER_FAILED');process.exit(1)})`,
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        ...env,
        APP_ENV: 'staging',
        NEXT_PUBLIC_MESSAGES_ENV: 'staging',
        ORDER_PREVIEW_MODE: '',
        STRIPE_PROVIDER_ENABLED: 'false',
        B06_DIST: path
          .relative(process.cwd(), path.join(folder, 'next'))
          .replaceAll('\\', '/'),
      },
    }
  )
  server.stdout.on('data', (chunk) => {
    if (String(chunk).includes('B06_READY')) ready = true
  })
  server.stderr.on('data', () => {})
  for (let n = 0; n < 90 && !ready; n++) await wait(1000)
  assert(ready, 'Local Staging app ready')
}
async function main() {
  save()
  await startServer()
  const opts = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  }
  admin = createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, opts)
  for (const role of ['seller', 'buyer', 'outsider']) {
    const u = {
      email: `b06-${run}-${role}@uwo.ca`,
      password: crypto.randomBytes(24).toString('hex') + 'Aa1!',
      cookies: new Map(),
      publicKey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    }
    const data = await ok(
      admin.auth.admin.createUser({
        email: u.email,
        password: u.password,
        email_confirm: true,
        user_metadata: {
          username:
            'B06_' + run.replaceAll('-', '').slice(0, 10) + '_' + role[0],
          b06QualificationRun: run,
        },
      }),
      'create run account'
    )
    u.id = data.user.id
    users.push(u)
    save()
    await api(u, '/api/auth/sign-in', { email: u.email, password: u.password })
    await api(u, '/api/notification-preferences', {
      key: 'email',
      value: false,
    })
    u.auth = createClient(url, u.publicKey, opts)
    u.token = (
      await ok(
        u.auth.auth.signInWithPassword({
          email: u.email,
          password: u.password,
        }),
        'isolated real session'
      )
    ).session.access_token
  }
  const [seller, buyer, outsider] = users
  pass(
    'three unique no-email test accounts; independent cookie and Auth sessions; email disabled only for fixtures'
  )
  const jpeg = await sharp({
    create: { width: 64, height: 48, channels: 3, background: '#839488' },
  })
    .jpeg()
    .toBuffer()
  const listing = await api(
    seller,
    '/api/listings',
    {
      title: 'B06 ' + run + ' Messages fixture',
      description: 'Disposable B06 qualification',
      price: 2500,
      currency: 'CAD',
      category: 'Electronics',
      subcategory: 'Cameras',
      condition: 'good',
      pickupArea: 'On campus',
      preferredFulfillment: 'ON_CAMPUS',
      preferredPaymentMode: 'external',
      meetingLocation: { label: 'B06 temporary meeting' },
      estimatedDeliveryFeeCents: 0,
      photoUrls: [],
      expectedImageCount: 1,
    },
    'POST',
    false,
    201
  )
  listingIds.push(listing.id)
  save()
  await api(
    seller,
    `/api/listing-images/${listing.id}?slot=1`,
    jpeg,
    'POST',
    true
  )
  await api(seller, `/api/listings/${listing.id}/finalize`, {})
  const contacts = await Promise.all(
    Array.from({ length: 3 }, () =>
      api(buyer, messages, { listingId: listing.id, intent: 'contact-seller' })
    )
  )
  const id = contacts[0].id
  conversationIds.push(id)
  save()
  assert(contacts.every((c) => c.id === id))
  let history = (await api(buyer, `${messages}/${id}/messages`)).messages
  assert.equal(history.length, 2)
  pass(
    'real published Resale Listing; three concurrent first contacts yield one Conversation and intro/ack pair'
  )
  const buyerFeed = await listen(buyer),
    sellerFeed = await listen(seller),
    outsiderFeed = await listen(outsider)
  pass('three independent private real WebSocket subscriptions established')
  let before = [buyerFeed.events.length, sellerFeed.events.length]
  const first = await text(buyer, id, 'buyer real websocket')
  await delivered(
    buyerFeed,
    sellerFeed,
    outsiderFeed,
    id,
    before,
    'Buyer TEXT delivered to both real WebSockets'
  )
  before = [buyerFeed.events.length, sellerFeed.events.length]
  await text(seller, id, 'seller real websocket')
  await delivered(
    buyerFeed,
    sellerFeed,
    outsiderFeed,
    id,
    before,
    'Seller TEXT delivered to both real WebSockets'
  )
  const payload = {
    type: 'TEXT',
    content: 'B06 concurrent idempotent text',
    clientMessageId: crypto.randomUUID(),
  }
  const repeat = await Promise.all(
    Array.from({ length: 3 }, () =>
      api(buyer, `${messages}/${id}/messages`, payload)
    )
  )
  assert(repeat.every((m) => m.id === repeat[0].id))
  history = (await api(seller, `${messages}/${id}/messages`)).messages
  assert(history.every((m, i) => m.sequence === i + 1))
  assert.equal(history.filter((m) => m.id === repeat[0].id).length, 1)
  const read = await api(seller, `${messages}/${id}/read`, {
    throughSequence: history.at(-1).sequence,
  })
  const stale = await api(seller, `${messages}/${id}/read`, {
    throughSequence: first.sequence,
  })
  assert.equal(stale.lastReadSequence, read.lastReadSequence)
  assert.equal(read.unreadCount, 0)
  await text(buyer, id, 'new unread after rendered boundary')
  const pending = await api(seller, `${messages}/${id}`)
  assert.equal(pending.unreadCount, 1)
  assert.equal(
    (
      await api(seller, `${messages}/${id}/read`, {
        throughSequence: read.lastReadSequence,
      })
    ).unreadCount,
    1
  )
  const boundary = (
    await api(seller, `${messages}/${id}/messages`)
  ).messages.at(-1).sequence
  assert.equal(
    (await api(seller, `${messages}/${id}/read`, { throughSequence: boundary }))
      .unreadCount,
    0
  )
  pass(
    'concurrent UUID sends persist once; canonical sequences monotonic; stale read cannot lower watermark'
  )
  await api(outsider, `${messages}/${id}`, undefined, 'GET', false, 404)
  await api(outsider, `${messages}/${id}/messages`, payload, 'POST', false, 404)
  const denied = await listen(outsider, topic(buyer.id), true, 'CHANNEL_ERROR')
  await close(denied)
  pass('outsider conversation read/write and foreign private topic denied')
  before = [buyerFeed.events.length, sellerFeed.events.length]
  await image(buyer, id, jpeg)
  await delivered(
    buyerFeed,
    sellerFeed,
    outsiderFeed,
    id,
    before,
    'IMAGE prepare/upload/finalize and signed bytes delivered over real WebSockets'
  )
  await imageRecovery(buyer, outsider, id, jpeg)
  await connectorRecovery(buyer, seller, id)
  await browserChecks(seller, buyer, outsider, id)
  await api(buyer, '/api/auth/sign-out', {})
  await api(buyer, messages + '?role=buying', undefined, 'GET', false, 401)
  await api(buyer, '/api/auth/sign-in', {
    email: buyer.email,
    password: buyer.password,
  })
  const persisted = (await api(buyer, `${messages}/${id}/messages`)).messages
  assert(persisted.some((m) => m.id === first.id))
  const buying = await api(buyer, messages + '?role=buying'),
    selling = await api(seller, messages + '?role=selling')
  assert(buying.conversations.some((c) => c.id === id))
  assert(selling.conversations.some((c) => c.id === id))
  assert.equal(
    (await api(buyer, messages + '?role=selling')).conversations.length,
    0
  )
  pass(
    'logout denies protected API; relogin restores canonical history; Buying/Selling remain separate'
  )
}
async function until(check, label, ms = 20000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (await check()) return
    await wait(100)
  }
  throw Error('Timed out: ' + label)
}
async function imageRecovery(buyer, outsider, id, bytes) {
  const key = crypto.randomUUID(),
    descriptor = {
      original_name: 'b06.jpg',
      mime_type: 'image/jpeg',
      size_bytes: bytes.length,
      sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    }
  const body = { clientMessageId: key, images: [descriptor] }
  const prepared = await api(buyer, `/api/messages/images/${id}/prepare`, body)
  const paths = sql(
    `select x.storage_path from public.image_message_submissions s cross join lateral jsonb_to_recordset(s.manifest) as x(storage_path text) where s.id=${q(
      prepared.id
    )};`
  )
  paths.forEach((row) => chatPaths.add(row.storage_path))
  save()
  // Consume and discard the successful response locally; retry the exact reservation.
  await api(
    buyer,
    `/api/messages/image-upload/${prepared.id}/${prepared.manifest[0].id}`,
    bytes,
    'POST',
    true
  )
  const again = await api(buyer, `/api/messages/images/${id}/prepare`, body)
  assert.equal(again.id, prepared.id)
  await api(
    buyer,
    `/api/messages/image-upload/${again.id}/${again.manifest[0].id}`,
    bytes,
    'POST',
    true
  )
  const sent = await api(buyer, `/api/messages/images/${again.id}/finalize`, {})
  const retried = await api(
    buyer,
    `/api/messages/images/${again.id}/finalize`,
    {}
  )
  assert.equal(sent.id, retried.id)
  await api(
    outsider,
    `/api/messages/images/${sent.id}`,
    undefined,
    'GET',
    false,
    404
  )
  const anonymous = createClient(url, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  })
  assert(
    (
      await anonymous.storage
        .from('chat-images')
        .download(paths[0].storage_path)
    ).error
  )
  assert(
    (
      await outsider.auth.storage
        .from('chat-images')
        .download(paths[0].storage_path)
    ).error
  )
  assert(
    (
      await buyer.auth.storage
        .from('chat-images')
        .download(paths[0].storage_path)
    ).error
  )
  pass(
    'lost upload response retry reuses reservation/object; finalize retry same message; signed renewal outsider denied; direct private bytes denied'
  )
}
async function connectorRecovery(buyer, seller, id) {
  const vm = require('node:vm'),
    ts = require('typescript'),
    clients = [],
    timers = new Set(),
    events = new EventTarget(),
    doc = new EventTarget()
  doc.visibilityState = 'visible'
  const mod = { exports: {} },
    signals = [],
    stats = { recover: 0, unauth: 0 }
  const sandbox = {
    module: mod,
    exports: mod.exports,
    process: {
      env: {
        NEXT_PUBLIC_MESSAGES_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: url,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: buyer.publicKey,
      },
    },
    window: events,
    document: doc,
    navigator: { onLine: true },
    URL,
    Date,
    Promise,
    JSON,
    atob,
    setTimeout: (fn, ms) => {
      const t = setTimeout(() => {
        timers.delete(t)
        fn()
      }, ms)
      timers.add(t)
      return t
    },
    clearTimeout: (t) => {
      clearTimeout(t)
      timers.delete(t)
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      json: () => api(buyer, '/api/messages/realtime-session', {}),
    }),
    require: (name) => {
      assert.equal(name, '@supabase/supabase-js')
      return {
        createClient: (...args) => {
          const c = createClient(...args)
          clients.push(c)
          if (clients.length === 1)
            c.realtime.setAuth = async () => {
              throw Error('B06 local one-shot init failure')
            }
          return c
        },
      }
    },
  }
  vm.runInNewContext(
    ts.transpileModule(fs.readFileSync('lib/messages-realtime.ts', 'utf8'), {
      compilerOptions: { module: 1, target: 7 },
    }).outputText,
    sandbox
  )
  const stop = mod.exports.connectMessagesRealtime(
    buyer.id,
    (s) => signals.push(s),
    () => stats.recover++,
    () => stats.unauth++
  )
  try {
    await until(
      () => stats.recover > 0,
      'actual connector recovers initial setAuth failure',
      25000
    )
    assert.equal(clients.length, 2)
    assert.equal(clients[0].getChannels().length, 0)
    assert.equal(clients[1].getChannels().length, 1)
    const n = signals.length
    await text(seller, id, 'after recovered connector')
    await until(() => signals.length > n, 'real event after startup recovery')
    const c = clients[1]
    // Close only this client's transport, as a network interruption would. Calling
    // SDK disconnect() requests intentional teardown and can race connect().
    const transport = c.realtime.socketAdapter.socket.conn
    assert(transport, 'Test client has an open transport')
    const r = stats.recover
    transport.close(4001, 'B06 client-only network interruption')
    events.dispatchEvent(new Event('online'))
    await until(
      () =>
        stats.recover > r &&
        c.realtime.isConnected() &&
        c.getChannels()[0]?.state === 'joined',
      'client-only disconnected socket rejoins private channel',
      30000
    )
    const next = signals.length
    await text(seller, id, 'after reconnect')
    await until(() => signals.length > next, 'real event after reconnect')
    events.dispatchEvent(new Event('marketplace-session-ended'))
    await until(
      () => clients.every((c) => c.getChannels().length === 0),
      'logout disposes all owned channels'
    )
    assert.equal(timers.size, 0)
    const end = signals.length
    await text(seller, id, 'after stopped connector')
    await wait(1000)
    assert.equal(signals.length, end)
    assert.equal(stats.unauth, 1)
    pass(
      'actual connector + live SDK: one-shot setAuth failure recovers, reconnect delivers, no duplicate channel, logout clears timers and rejects late events'
    )
  } finally {
    stop()
    for (const c of clients) {
      await c.removeAllChannels()
      c.realtime.disconnect()
    }
    for (const t of timers) clearTimeout(t)
  }
}
async function browserChecks(seller, buyer, outsider, id) {
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const sessions = []
  for (const user of [seller, buyer]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    })
    await context.addCookies(
      [...user.cookies]
        .filter(([, v]) => v)
        .map(([name, value]) => ({ name, value, url: base, httpOnly: true }))
    )
    const page = await context.newPage()
    page.setDefaultNavigationTimeout(120000)
    await page.addInitScript(() => {
      delete Navigator.prototype.serviceWorker
    })
    await page.route('**/*', (route) =>
      [base, url].includes(new URL(route.request().url()).origin)
        ? route.continue()
        : route.abort()
    )
    await page.goto(
      `${base}/home?section=messages&destination=${
        user === buyer ? 'buying' : 'selling'
      }&conversation=${id}`,
      { waitUntil: 'domcontentloaded' }
    )
    await page
      .locator(`[data-message-history="${id}"]`)
      .waitFor({ timeout: 90000 })
    sessions.push({ context, page })
  }
  const [S, B] = sessions
  const message = await text(buyer, id, 'visible in Seller real UI')
  await S.page
    .locator(`[data-message-id="${message.id}"]`)
    .waitFor({ timeout: 25000 })
  const reply = await text(seller, id, 'visible in Buyer real UI')
  await B.page
    .locator(`[data-message-id="${reply.id}"]`)
    .waitFor({ timeout: 25000 })
  const sendInUi = async (from, to, content) => {
    const input = from.page.getByRole('textbox', {
      name: 'Message',
      exact: true,
    })
    await input.click()
    await input.pressSequentially(content, { delay: 10 })
    const sent = from.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname === `${messages}/${id}/messages`
    )
    await from.page.locator('[data-chat-send]').click()
    const response = await sent
    assert.equal(response.status(), 200)
    const item = await response.json()
    await to.page
      .locator(`[data-message-id="${item.id}"]`)
      .waitFor({ timeout: 25000 })
  }
  await sendInUi(B, S, 'B06 actual Buyer composer')
  await sendInUi(S, B, 'B06 actual Seller composer')
  await B.page.reload({ waitUntil: 'domcontentloaded' })
  await B.page
    .locator(`[data-message-id="${reply.id}"]`)
    .waitFor({ timeout: 60000 })
  for (const width of [390, 430, 820, 1280, 1536]) {
    await B.page.setViewportSize({ width, height: 900 })
    // Breakpoint reconciliation may render its existing skeleton/list first.
    // Reopen the same canonical deep link and wait for real history, not a timer.
    await B.page.goto(
      `${base}/home?section=messages&destination=buying&conversation=${id}`,
      { waitUntil: 'domcontentloaded' }
    )
    await B.page
      .locator(`[data-message-id="${reply.id}"]`)
      .waitFor({ timeout: 60000 })
    assert(
      await B.page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1
      ),
      'Messages horizontal overflow'
    )
    await B.page.screenshot({
      path: path.join(folder, `messages-${width}.png`),
    })
  }
  pass(
    'two real logged-in current Messages pages receive live canonical updates; refresh persists; five viewport checks'
  )
  // Same browser context: real logout, a different real identity, then a message
  // to the old recipient. Only this test page dispatches the existing logout signal.
  await B.page.evaluate(async () => {
    const response = await fetch('/api/auth/sign-out', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Marketplace-Request': '1',
      },
      body: '{}',
    })
    if (!response.ok) throw Error('B06 browser logout failed')
    window.dispatchEvent(new Event('marketplace-session-ended'))
  })
  assert.equal(
    (await B.context.request.get(base + messages + '?role=buying')).status(),
    401
  )
  const login = await B.context.request.post(base + '/api/auth/sign-in', {
    headers: { Origin: base, 'X-Marketplace-Request': '1' },
    data: { email: outsider.email, password: outsider.password },
  })
  assert.equal(login.status(), 200)
  await B.page.goto(base + '/home?section=messages&destination=buying', {
    waitUntil: 'domcontentloaded',
  })
  await until(async () => {
    const response = await B.context.request.get(base + '/api/auth/session')
    return (await response.json()).seller?.id === outsider.id
  }, 'browser switched identity')
  const late = await text(seller, id, 'late event after browser account switch')
  await wait(1500)
  assert.equal(
    await B.page.locator(`[data-message-id="${late.id}"]`).count(),
    0
  )
  assert.equal(
    (await B.context.request.get(base + messages + '/' + id)).status(),
    404
  )
  assert.equal(
    (
      await (
        await B.context.request.get(base + messages + '?role=buying')
      ).json()
    ).conversations.length,
    0
  )
  pass(
    'same real browser context logout/account switch: old-user late message cannot populate new identity; old conversation API denied'
  )
}
async function cleanupRun() {
  if (browser) await browser.close()
  for (const s of sockets) await close(s)
  if (server) server.kill()
  if (!admin) return
  const discovered = sql(
    `select id from auth.users where raw_user_meta_data->>'b06QualificationRun'=${q(
      run
    )};`
  )
  for (const u of discovered)
    if (!users.some((v) => v.id === u.id)) users.push(u)
  if (!users.length) {
    cleanupComplete = true
    save()
    return
  }
  const own = ids(users.map((u) => u.id))
  const ls = sql(
    `select id,seller_id from public.listings where seller_id in (${own}) and starts_with(title,${q(
      'B06 ' + run
    )});`
  )
  for (const l of ls) if (!listingIds.includes(l.id)) listingIds.push(l.id)
  const cs = sql(
    `select id from public.conversations where buyer_id in (${own}) and seller_id in (${own});`
  )
  for (const c of cs)
    if (!conversationIds.includes(c.id)) conversationIds.push(c.id)
  const cid = ids(conversationIds),
    lid = ids(listingIds)
  const objects = sql(
    `select bucket_id,name from storage.objects where (bucket_id='chat-images' and split_part(name,'/',1) in (${cid})) or (bucket_id='listing-images-private' and split_part(name,'/',1) in (${own}));`
  )
  // Stop if any unexpected owner or financial reference exists; never expand scope.
  const safe = sql(
    `select (select count(*) from public.conversations where id in (${cid}) and (buyer_id not in (${own}) or seller_id not in (${own}))) as foreign_conversations,(select count(*) from public.orders where listing_id in (${lid})) as orders,(select count(*) from auth.users where id in (${own}) and raw_user_meta_data->>'b06QualificationRun' is distinct from ${q(
      run
    )}) as foreign_users;`
  )[0]
  assert(
    Object.values(safe).every((n) => Number(n) === 0),
    'cleanup scope check'
  )
  sql(
    `begin;set local lock_timeout='5s';delete from public.notifications where recipient_user_id in (${own});delete from marketplace_private.notification_events where destination->>'conversationId' in (${cid});delete from public.conversations where id in (${cid});delete from public.listings where id in (${lid}) and seller_id in (${own}) and reserved_order_id is null;commit;`
  )
  for (const bucket of ['chat-images', 'listing-images-private']) {
    const paths = objects
      .filter((o) => o.bucket_id === bucket)
      .map((o) => o.name)
    if (paths.length)
      await ok(
        admin.storage.from(bucket).remove(paths),
        'remove exact run image objects'
      )
    for (const p of paths)
      assert((await admin.storage.from(bucket).info(p)).error)
  }
  sql(
    `delete from marketplace_private.chat_image_cleanup q where split_part(q.storage_path,'/',1) in (${cid}) and not exists(select 1 from storage.objects o where o.bucket_id='chat-images' and o.name=q.storage_path) and not exists(select 1 from public.message_images mi where mi.storage_path=q.storage_path);`
  )
  for (const u of users) {
    const data = await ok(
      admin.auth.admin.getUserById(u.id),
      'check test ownership'
    )
    assert.equal(data.user.user_metadata.b06QualificationRun, run)
    await ok(admin.auth.admin.deleteUser(u.id), 'delete only run account')
    u.cleaned = true
    save()
  }
  const residue = sql(
    `select (select count(*) from auth.users where id in (${own})) users,(select count(*) from public.profiles where id in (${own})) profiles,(select count(*) from public.conversations where id in (${cid})) conversations,(select count(*) from public.messages where conversation_id in (${cid})) messages,(select count(*) from public.image_message_submissions where conversation_id in (${cid})) submissions,(select count(*) from public.listings where id in (${lid})) listings,(select count(*) from public.notifications where recipient_user_id in (${own})) notifications,(select count(*) from marketplace_private.notification_events where destination->>'conversationId' in (${cid})) events,(select count(*) from marketplace_private.chat_image_cleanup where split_part(storage_path,'/',1) in (${cid})) queue,(select count(*) from storage.objects where (bucket_id='chat-images' and split_part(name,'/',1) in (${cid})) or (bucket_id='listing-images-private' and split_part(name,'/',1) in (${own}))) objects;`
  )[0]
  assert(
    Object.values(residue).every((n) => Number(n) === 0),
    'test residue zero'
  )
  cleanupComplete = true
  pass(
    'exact run users, Listings, Conversations, Messages, submissions, notifications and Storage cleanup verified zero residue',
    residue
  )
}
(async () => {
  try {
    await main()
  } catch (e) {
    failure = String(e.message)
      .replace(/eyJ[\w.-]+/g, '[redacted]')
      .replace(/https?:\/\/\S+/g, '[url]')
    console.error('B06 STOP: ' + failure)
    save()
  } finally {
    try {
      await cleanupRun()
    } catch (e) {
      failure ||= 'cleanup failed'
      console.error('B06 CLEANUP STOP: ' + String(e.message).slice(0, 180))
      save()
    }
    save()
  }
  console.log(JSON.stringify({ run, cleanupComplete, passed: !failure }))
  if (failure) process.exitCode = 1
})()
