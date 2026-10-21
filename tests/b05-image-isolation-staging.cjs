// Explicit-target B05 acceptance; preflight mode never writes remotely.
/* global Request, fetch, document, localStorage */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  crypto = require('node:crypto'),
  ts = require('typescript'),
  { Readable } = require('node:stream'),
  sharp = require('sharp')
const { createClient } = require('@supabase/supabase-js')
const { environment, query } = require('../scripts/v2-maintenance-staging.cjs')
const env = environment(),
  ref = 'pcaqxezdfxofysghssyo',
  origin = `https://${ref}.supabase.co`
assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, origin)
const mode = process.argv[2] || 'preflight'
assert(['preflight', 'accept'].includes(mode))
function preflight() {
  const rows = query(
    "begin read only;select t.tgname,n.nspname schema,p.proname,pg_get_functiondef(p.oid) definition from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_namespace n on n.oid=p.pronamespace where t.tgrelid in ('public.listings'::regclass,'public.listing_images'::regclass,'public.listing_favorites'::regclass,'auth.users'::regclass) and not t.tgisinternal order by t.tgname;rollback;"
  )
  fs.writeFileSync(
    'tests/artifacts/b05-trigger-preflight.json',
    JSON.stringify(rows, null, 2)
  )
  console.log(
    JSON.stringify(
      {
        projectRef: ref,
        triggers: rows.map((r) => ({
          name: r.tgname,
          function: r.schema + '.' + r.proname,
          externalCallPattern:
            /net\.http|http_post|http_get|pg_net|cron\.|vault\./i.test(
              r.definition
            ),
        })),
      },
      null,
      2
    )
  )
  return rows
}
if (mode === 'preflight') {
  preflight()
  process.exit(0)
}
assert.equal(process.env.B05_STAGING_WRITE_APPROVED, '1')
for (const key of [
  'APP_ENV',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
])
  process.env[key] = env[key]
process.env.SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
process.env.NEXT_PUBLIC_MESSAGES_ENV = 'staging'
assert.equal(process.env.NEXT_PUBLIC_MESSAGES_ENV, 'staging')
const runId = crypto.randomUUID(),
  users = [],
  listings = new Map(),
  objectPaths = new Set(),
  checks = [],
  actions = [],
  faults = [],
  cleanup = [],
  appLogs = []
const folder = path.resolve('tests/artifacts/b05-image-live-' + runId)
fs.mkdirSync(folder, { recursive: true })
let step = 'initial',
  fault = null,
  failed = false,
  cleanupComplete = false,
  server,
  browser
const save = () =>
  fs.writeFileSync(
    path.join(folder, 'result.json'),
    JSON.stringify(
      {
        runId,
        projectRef: ref,
        step,
        failed,
        cleanupComplete,
        users: users.map((u) => ({ id: u.id, cleaned: !!u.cleaned })),
        listings: [...listings].map(([id, owner]) => ({ id, owner })),
        objectPaths: [...objectPaths],
        checks,
        actions,
        faults,
        cleanup,
        appLogs,
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
const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
function subject(headers) {
  try {
    return JSON.parse(
      Buffer.from(
        new Headers(headers)
          .get('authorization')
          .replace('Bearer ', '')
          .split('.')[1],
        'base64url'
      )
    ).sub
  } catch {
    return null
  }
}
function fixturePath(p) {
  return [...listings].some(([id, owner]) =>
    p.startsWith(owner + '/' + id + '/')
  )
}
global.fetch = async (input, init = {}) => {
  const url = new URL(input instanceof Request ? input.url : String(input)),
    method = init.method || 'GET',
    p = url.pathname
  assert.equal(url.origin, origin, 'Only exact Staging origin')
  assert(
    !/\/(signup|otp|recover|verify|resend|reauthenticate|invite|generate_link)$/.test(
      p
    ),
    'No mail endpoints'
  )
  const body = typeof init.body === 'string' ? JSON.parse(init.body) : null
  if (method !== 'GET') {
    if (p === '/auth/v1/admin/users' && method === 'POST') {
      assert(body.email.startsWith('b05-' + runId + '-'))
      assert.equal(body.email_confirm, true)
      assert.equal(body.user_metadata.b05QualificationRun, runId)
    } else if (p.startsWith('/auth/v1/admin/users/') && method === 'DELETE')
      assert(users.some((u) => p.endsWith('/' + u.id)))
    else if (p === '/auth/v1/token') {
      assert.equal(url.searchParams.get('grant_type'), 'password')
      assert(users.some((u) => u.email === body.email))
    } else if (p === '/auth/v1/logout')
      assert(users.some((u) => u.id === subject(init.headers)))
    else if (p === '/rest/v1/rpc/marketplace_set_notification_preference') {
      assert(users.some((u) => u.id === subject(init.headers)))
      assert.deepEqual(body, { p_key: 'email', p_value: false })
    } else if (p === '/rest/v1/rpc/marketplace_finalize_listing')
      assert(listings.has(body.listing_id))
    else if (p === '/rest/v1/listings') {
      if (method === 'POST') {
        assert(users.some((u) => u.id === subject(init.headers)))
        assert(body.title.startsWith('B05 ' + runId))
      } else
        assert(
          listings.has((url.searchParams.get('id') || '').replace('eq.', ''))
        )
    } else if (p === '/rest/v1/listing_images') {
      if (method === 'POST') assert(listings.has(body.listing_id))
      else
        assert(
          [...objectPaths].some((x) =>
            x.endsWith(
              '/' + (url.searchParams.get('id') || '').replace('eq.', '')
            )
          )
        )
    } else if (p === '/rest/v1/listing_favorites') {
      const target =
        body?.listing_id ||
        (url.searchParams.get('listing_id') || '').replace('eq.', '')
      assert(listings.has(target))
      if (body?.user_id) assert(users.some((u) => u.id === body.user_id))
    } else if (
      p.startsWith('/storage/v1/object/listing-images-private/') &&
      method === 'POST'
    ) {
      const key = decodeURIComponent(
        p.slice('/storage/v1/object/listing-images-private/'.length)
      )
      assert(fixturePath(key))
      objectPaths.add(key)
    } else if (
      p === '/storage/v1/object/listing-images-private' &&
      method === 'DELETE'
    )
      assert(body.prefixes.every(fixturePath))
    else if (
      p === '/storage/v1/object/list/listing-images-private' &&
      method === 'POST'
    )
      assert(
        [...listings].some(([id, owner]) => body.prefix === owner + '/' + id)
      )
    else throw Error('Unexpected write blocked')
  }
  if (
    fault?.kind === 'reject-upload' &&
    p.startsWith('/storage/v1/object/listing-images-private/') &&
    method === 'POST'
  ) {
    faults.push({ kind: fault.kind, path: p })
    fault = null
    return json(
      { message: 'Controlled local upload failure', statusCode: '503' },
      503
    )
  }
  if (
    fault?.kind === 'reject-abandon' &&
    p === '/rest/v1/listings' &&
    method === 'DELETE' &&
    url.searchParams.get('id') === 'eq.' + fault.id
  ) {
    faults.push({ kind: fault.kind, listingId: fault.id })
    fault = null
    return json(
      { code: 'B05_LOCAL_FAULT', message: 'Controlled local delete rejection' },
      503
    )
  }
  const response = await nativeFetch(input, init)
  if (p === '/rest/v1/listings' && method === 'POST' && response.ok) {
    const rows = await response.clone().json()
    for (const row of Array.isArray(rows) ? rows : [rows]) {
      assert(users.some((u) => u.id === row.seller_id))
      listings.set(row.id, row.seller_id)
    }
    save()
  }
  actions.push({
    path: p.replace(/\/admin\/users\/.+$/, '/admin/users/<run-user>'),
    method,
    status: response.status,
  })
  if (
    fault?.kind === 'lose-upload-response' &&
    p.startsWith('/storage/v1/object/listing-images-private/') &&
    method === 'POST' &&
    response.ok
  ) {
    faults.push({ kind: fault.kind, path: p, actualStatus: response.status })
    fault = null
    return json(
      { message: 'Controlled locally lost response', statusCode: '503' },
      503
    )
  }
  return response
}
const opts = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
}
const admin = createClient(origin, env.SUPABASE_SERVICE_ROLE_KEY, opts)
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (n) =>
      n.startsWith('@/')
        ? load(n.slice(2) + '.ts')
        : n.startsWith('.')
        ? load(path.resolve(path.dirname(full), n) + '.ts')
        : require(n),
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const handlers = {
  auth: load('pages/api/auth/[action].ts').default,
  listings: load('pages/api/listings/[[...segments]].ts').default,
  images: load('pages/api/listing-images/[id].ts').default,
  favorites: load('pages/api/favorites/[[...segments]].ts').default,
  media: load('pages/api/listing-media/[imageId].ts').default,
  preferences: load('pages/api/notification-preferences.ts').default,
}
const { createMarketplaceClient } = load('lib/supabase/server.ts'),
  publication = load('lib/listing-publication.ts')
const device = () => ({ cookies: new Map() })
function context(d, method, query = {}, body, headers = {}) {
  const h = new Map(),
    req = Buffer.isBuffer(body) ? Readable.from([body]) : {}
  Object.assign(req, {
    method,
    query,
    body,
    headers: {
      host: 'localhost:3000',
      origin: 'http://localhost:3000',
      'x-marketplace-request': '1',
      cookie: [...d.cookies].map(([k, v]) => k + '=' + v).join('; '),
      ...headers,
    },
  })
  const res = {
    code: 200,
    getHeader: (k) => h.get(k),
    setHeader: (k, v) => h.set(k, v),
    status(c) {
      this.code = c
      return this
    },
    send(b) {
      this.body = b
      return this
    },
    end() {
      return this
    },
    json(b) {
      this.body = b
      return this
    },
  }
  return { req, res, h }
}
function remember(d, c) {
  for (const v of c.h.get('Set-Cookie') || []) {
    const p = v.split(';')[0],
      i = p.indexOf('=')
    if (/Max-Age=0/i.test(v)) d.cookies.delete(p.slice(0, i))
    else d.cookies.set(p.slice(0, i), p.slice(i + 1))
  }
}
async function call(
  d,
  kind,
  method,
  query = {},
  body,
  expected = 200,
  headers = {}
) {
  const c = context(d, method, query, body, headers)
  await handlers[kind](c.req, c.res)
  remember(d, c)
  assert.equal(
    c.res.code,
    expected,
    'API rejected at ' + step + ' (' + kind + '): ' + c.res.code
  )
  return c.res.body
}
async function ok(p) {
  const r = await p
  assert(!r.error, 'Provider rejected at ' + step)
  return r.data
}
const client = (d) => createMarketplaceClient(context(d, 'GET'))
const input = (label, count = 3) => ({
  title: 'B05 ' + runId + ' ' + label,
  description: 'Temporary B05 acceptance fixture',
  price: 2500,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'On campus',
  preferredFulfillment: 'ON_CAMPUS',
  preferredPaymentMode: 'external',
  meetingLocation: { label: 'B05 test meeting location' },
  estimatedDeliveryFeeCents: 0,
  photoUrls: [],
  expectedImageCount: count,
})
const list = (d) => ({
  createListing: (body) => call(d, 'listings', 'POST', {}, body, 201),
  getCreationListing: (id) =>
    call(d, 'listings', 'GET', { segments: [id, 'creation'] }),
  uploadListingImage: async (id, file, slot) => {
    const c = context(d, 'POST', { id, slot: String(slot) }, file.bytes, {
      'content-type': file.type,
      'content-length': String(file.size),
    })
    await handlers.images(c.req, c.res)
    remember(d, c)
    if (c.res.code !== 200)
      throw Error(c.res.body?.error || 'Upload unconfirmed')
    return c.res.body
  },
  finalizeListing: (id) =>
    call(d, 'listings', 'POST', { segments: [id, 'finalize'] }),
  abandonListing: async (id) => {
    const c = context(d, 'POST', { segments: [id, 'abandon'] })
    await handlers.listings(c.req, c.res)
    remember(d, c)
    if (c.res.code !== 200) throw Error('Cleanup unconfirmed')
  },
})
const originalWarn = console.warn,
  originalError = console.error
console.warn = (message, data) => {
  if (String(message).startsWith('Listing draft cleanup unconfirmed')) {
    appLogs.push({ message, listingId: data?.listingId, status: data?.status })
    save()
  }
}
console.error = () => {} // Never dump SDK errors, credentials or request bodies.
async function cleanupRun() {
  fault = null
  // Recover exact-run IDs even if a create response was lost before journaling.
  const discoveredUsers = query(
    `begin read only;select id from auth.users where raw_user_meta_data->>'b05QualificationRun'='${runId}';rollback;`
  )
  for (const row of discoveredUsers)
    if (!users.some((u) => u.id === row.id)) users.push({ id: row.id })
  if (users.length) {
    const own = users.map((u) => "'" + u.id + "'").join(',')
    const discoveredListings = query(
      `begin read only;select id,seller_id from public.listings where seller_id in(${own}) and starts_with(title,'B05 ${runId}');rollback;`
    )
    for (const row of discoveredListings) listings.set(row.id, row.seller_id)
  }
  for (const [id, owner] of listings) {
    try {
      const data = query(
        `begin read only;select id,seller_id,title,published_at from public.listings where id='${id}';rollback;`
      )[0]
      if (data) {
        assert.equal(data.seller_id, owner)
        assert(data.title.startsWith('B05 ' + runId))
        query(
          `begin;set local lock_timeout='5s';do $$begin if not exists(select 1 from auth.users where id='${owner}' and raw_user_meta_data->>'b05QualificationRun'='${runId}') or exists(select 1 from public.orders where listing_id='${id}') then raise exception 'B05 cleanup scope mismatch';end if;end;$$;delete from public.listings where id='${id}' and seller_id='${owner}' and starts_with(title,'B05 ${runId}') and reserved_order_id is null;commit;`
        )
      }
      const prefix = owner + '/' + id
      const files = await ok(
        admin.storage
          .from('listing-images-private')
          .list(prefix, { limit: 100 })
      )
      assert(files.length < 100)
      const paths = files.map((o) => prefix + '/' + o.name)
      if (paths.length)
        await ok(admin.storage.from('listing-images-private').remove(paths))
      assert.equal(
        (
          await ok(
            admin.storage
              .from('listing-images-private')
              .list(prefix, { limit: 100 })
          )
        ).length,
        0
      )
      cleanup.push({ listingId: id, removed: true })
      save()
    } catch {
      cleanup.push({ listingId: id, removed: false })
      save()
    }
  }
  const listingCleanupOK = cleanup.every((x) => x.removed)
  for (const u of users) {
    try {
      assert(
        listingCleanupOK,
        'Retain fixture owner for unresolved listing cleanup'
      )
      const data = await ok(admin.auth.admin.getUserById(u.id))
      assert.equal(data.user.user_metadata.b05QualificationRun, runId)
      await ok(admin.auth.admin.deleteUser(u.id))
      assert(!(await admin.auth.admin.getUserById(u.id)).data.user)
      u.cleaned = true
      save()
    } catch {
      u.cleaned = false
      save()
    }
  }
  const ids = [...listings.keys()],
    owners = users.map((u) => u.id)
  if (owners.length) {
    const quoted = owners.map((v) => "'" + v + "'").join(','),
      ls = ids.length
        ? ids.map((v) => "'" + v + "'").join(',')
        : "'00000000-0000-0000-0000-000000000000'"
    const rows = query(
      `begin read only;select (select count(*) from auth.users where id in(${quoted})) users,(select count(*) from auth.identities where user_id in(${quoted})) identities,(select count(*) from auth.sessions where user_id in(${quoted})) sessions,(select count(*) from auth.refresh_tokens where user_id in(${quoted})) refresh_tokens,(select count(*) from public.profiles where id in(${quoted})) profiles,(select count(*) from public.listings where seller_id in(${quoted}) or id in(${ls})) listings,(select count(*) from public.listing_images where owner_id in(${quoted}) or listing_id in(${ls})) images,(select count(*) from public.listing_favorites where user_id in(${quoted}) or listing_id in(${ls})) favorites,(select count(*) from public.notification_preferences where user_id in(${quoted})) preferences,(select count(*) from marketplace_private.account_activity_events where owner_id in(${quoted})) activity,(select count(*) from storage.objects where bucket_id='listing-images-private' and split_part(name,'/',1) in(${quoted})) objects;rollback;`
    )[0]
    cleanup.push({ remaining: rows })
    assert(
      Object.values(rows).every((v) => Number(v) === 0),
      'Cleanup residue'
    )
  }
  cleanupComplete = listingCleanupOK && users.every((u) => u.cleaned)
  save()
}
async function imageRead(d, imageId, expected) {
  const c = context(d, 'GET', { imageId })
  await handlers.media(c.req, c.res)
  remember(d, c)
  assert.equal(c.res.code, expected, 'image API at ' + step)
  assert.match(String(c.h.get('Cache-Control')), /private, no-store/)
  assert(!c.h.has('Location'))
  assert(!c.h.has('ETag'))
  if (expected === 200) assert(Buffer.isBuffer(c.res.body))
  else assert.deepEqual(c.res.body, { error: 'Image not found.' })
  actions.push({
    imageId,
    method: 'image-api',
    status: c.res.code,
    cache: c.h.get('Cache-Control'),
  })
  save()
  return c.res.body
}
async function directProbes(ownerClient, otherClient, key, bytes, state) {
  const otherToken = (await otherClient.auth.getSession()).data.session
    .access_token
  for (const route of [
    '/storage/v1/object/public/listing-images-private/',
    '/storage/v1/object/authenticated/listing-images-private/',
    '/storage/v1/object/listing-images-private/',
    '/storage/v1/render/image/public/listing-images-private/',
    '/storage/v1/render/image/authenticated/listing-images-private/',
  ])
    for (const role of ['anon', 'other']) {
      const response = await fetch(
        origin +
          route +
          key +
          (route.includes('/render/') ? '?width=32' : '?download=1'),
        {
          headers: {
            apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            ...(role === 'other'
              ? { Authorization: 'Bearer ' + otherToken }
              : {}),
          },
        }
      )
      const body = Buffer.from(await response.arrayBuffer()),
        type = response.headers.get('content-type') || ''
      assert(!type.startsWith('image/'), 'unauthorized Storage image MIME')
      assert(!body.equals(bytes), 'unauthorized Storage image bytes')
      assert(!response.ok, 'unauthorized Storage success')
      actions.push({
        method: 'storage-probe',
        state,
        role,
        route,
        status: response.status,
        contentType: type,
        bytes: body.length,
      })
    }
  const own = await ok(
    ownerClient.storage.from('listing-images-private').download(key)
  )
  assert(Buffer.from(await own.arrayBuffer()).equals(bytes))
  save()
}
async function main() {
  save()
  try {
    step = 'create no-email fixtures'
    const health = await fetch(origin + '/auth/v1/health', {
      headers: { apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
    })
    assert(health.ok)
    for (let i = 0; i < 3; i++) {
      const u = {
        email: `b05-${runId}-${i}@uwo.ca`,
        password: crypto.randomBytes(24).toString('hex') + 'Aa1!',
        username: 'B05_' + runId.replaceAll('-', '').slice(0, 10) + i,
      }
      const data = await ok(
        admin.auth.admin.createUser({
          email: u.email,
          password: u.password,
          email_confirm: true,
          user_metadata: { username: u.username, b05QualificationRun: runId },
        })
      )
      u.id = data.user.id
      users.push(u)
      save()
    }
    const [seller, buyer, outsider] = users,
      S = device(),
      B = device(),
      O = device(),
      N = device()
    for (const [u, d] of [
      [seller, S],
      [buyer, B],
      [outsider, O],
    ]) {
      await call(
        d,
        'auth',
        'POST',
        { action: 'sign-in' },
        { email: u.email, password: u.password }
      )
      await call(d, 'preferences', 'POST', {}, { key: 'email', value: false })
    }
    pass(
      'Three isolated test users; no-email creation; only their email preferences disabled'
    )
    const files = []
    for (const [format, type, color] of [
      ['jpeg', 'image/jpeg', '#839488'],
      ['png', 'image/png', '#a7a390'],
      ['webp', 'image/webp', '#987b90'],
    ]) {
      const bytes = await sharp({
        create: { width: 48, height: 40, channels: 3, background: color },
      })
        .toFormat(format)
        .toBuffer()
      files.push({ type, size: bytes.length, bytes })
    }
    const ops = list(S)
    step = 'normal Resale create and publish'
    const normal = await publication.createPublishedListing(
      input('normal'),
      files,
      ops
    )
    assert.equal(normal.state, 'published')
    const normalId = normal.listingId
    assert.equal(normal.listing.seller.id, seller.id)
    assert.equal(normal.listing.listingChannel, 'resale')
    assert.equal(normal.listing.expectedImageCount, 3)
    assert.equal(normal.listing.photoUrls.length, 3)
    assert.equal(
      (await call(N, 'listings', 'GET', { segments: [normalId] })).id,
      normalId
    )
    const publicImages = await ok(
      createClient(origin, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, opts)
        .from('listing_images')
        .select('id,path,slot,ready,storage_bucket')
        .eq('listing_id', normalId)
        .order('slot')
    )
    assert.equal(publicImages.length, 3)
    for (let i = 0; i < 3; i++) {
      assert(publicImages[i].ready)
      assert.equal(publicImages[i].storage_bucket, 'listing-images-private')
      const response = await imageRead(
        N,
        normal.listing.photoUrls[i].split('/').pop(),
        200
      )
      assert(response.equals(files[i].bytes))
    }
    pass(
      'Normal JPEG/PNG/WebP upload + publish: owner, resale channel, complete ordered manifest and anonymous read persisted'
    )
    await directProbes(
      client(S),
      client(O),
      publicImages[0].path,
      files[0].bytes,
      'published'
    )
    const publicSeller = await load(
      'lib/server/public-seller.ts'
    ).getPublicSeller(seller.id)
    assert(
      publicSeller.listings.some(
        (l) =>
          l.id === normalId && l.photoUrls[0] === normal.listing.photoUrls[0]
      )
    )
    pass(
      'Anonymous published API image bytes + Seller projection; direct private Storage still inaccessible'
    )
    step = 'controlled upload failure and concurrent same-ID recovery'
    let uploadIndex = 0
    const failingOps = {
      ...ops,
      uploadListingImage: async (id, file, slot) => {
        uploadIndex++
        if (uploadIndex === 2) fault = { kind: 'reject-upload' }
        return ops.uploadListingImage(id, file, slot)
      },
    }
    const pending = await publication.createPublishedListing(
      input('failed-upload'),
      files,
      failingOps
    )
    assert.equal(pending.state, 'unpublished')
    const pendingId = pending.listingId
    assert.equal(
      await call(N, 'listings', 'GET', { segments: [pendingId] }),
      null
    )
    const beforeCount = listings.size
    const recovered = await Promise.all([
      publication.continueListingPublication(pendingId, ops, files),
      publication.continueListingPublication(pendingId, ops, files),
    ])
    assert(recovered.some((x) => x.state === 'published'))
    assert.equal(
      (await ops.getCreationListing(pendingId)).publishedAt !== null,
      true
    )
    assert.equal(listings.size, beforeCount)
    assert.equal(
      (
        await ok(
          client(S)
            .from('listing_images')
            .select('id,path,slot')
            .eq('listing_id', pendingId)
        )
      ).length,
      3
    )
    await ops.finalizeListing(pendingId)
    await ops.finalizeListing(pendingId)
    assert.equal(listings.size, beforeCount)
    pass(
      'Partial upload failure retains original ID; concurrent recovery + finalize retries publish one Listing with three unique slots'
    )
    step = 'lost real Storage upload response'
    let index = 0
    const lostOps = {
      ...ops,
      uploadListingImage: async (id, file, slot) => {
        index++
        if (index === 2) fault = { kind: 'lose-upload-response' }
        return ops.uploadListingImage(id, file, slot)
      },
    }
    const lost = await publication.createPublishedListing(
      input('lost-response'),
      files,
      lostOps
    )
    assert.equal(lost.state, 'unpublished')
    const pathsBefore = actions
      .filter(
        (x) =>
          x.path?.includes('/' + lost.listingId + '/') &&
          x.method === 'POST' &&
          x.status < 300
      )
      .map((x) => x.path)
    assert.equal(pathsBefore.length, 2)
    assert.equal(
      (await publication.continueListingPublication(lost.listingId, ops, files))
        .state,
      'published'
    )
    const actualWrites = actions.filter(
      (x) =>
        x.path?.includes('/' + lost.listingId + '/') &&
        x.method === 'POST' &&
        x.status < 300
    )
    assert.equal(actualWrites.length, 3)
    assert.equal(new Set(actualWrites.map((x) => x.path)).size, 3)
    pass(
      'Committed upload with locally lost response reconciles stored bytes; only missing third photo uploaded, no overwrite'
    )
    step = 'unpublished owner, outsider, anonymous and malformed media'
    const draft = await ops.createListing(input('private-draft', 1)),
      draftId = draft.id
    for (const d of [B, O, N]) {
      assert.equal(
        await call(d, 'listings', 'GET', { segments: [draftId] }),
        null
      )
      const images = await ok(
        client(d)
          .from('listing_images')
          .select('id,path')
          .eq('listing_id', draftId)
      )
      assert.equal(images.length, 0)
    }
    for (const method of ['PATCH', 'DELETE']) {
      const table = client(O).from('listings')
      const mutation =
        method === 'PATCH'
          ? table.update({ title: 'B05 ' + runId + ' forged' })
          : table.delete()
      const r = await mutation.eq('id', draftId).select('id')
      assert(!r.data?.length)
    }
    await call(
      O,
      'listings',
      'POST',
      { segments: [draftId, 'finalize'] },
      undefined,
      403
    )
    await call(
      O,
      'listings',
      'PATCH',
      { segments: [draftId] },
      { title: 'B05 ' + runId + ' outsider' },
      404
    )
    await call(
      N,
      'listings',
      'POST',
      { segments: [draftId, 'finalize'] },
      undefined,
      401
    )
    const bad = Buffer.from('not an image')
    await call(S, 'images', 'POST', { id: draftId, slot: '1' }, bad, 400, {
      'content-type': 'image/png',
      'content-length': String(bad.length),
    })
    await call(
      S,
      'images',
      'POST',
      { id: draftId, slot: '2' },
      files[0].bytes,
      400,
      { 'content-type': files[0].type }
    )
    await call(
      O,
      'images',
      'POST',
      { id: draftId, slot: '1' },
      files[0].bytes,
      404,
      { 'content-type': files[0].type }
    )
    await call(
      N,
      'images',
      'POST',
      { id: draftId, slot: '1' },
      files[0].bytes,
      401,
      { 'content-type': files[0].type }
    )
    await ops.uploadListingImage(draftId, files[0], 1)
    assert.equal(
      (
        await ok(
          client(B)
            .from('listing_images')
            .select('path')
            .eq('listing_id', draftId)
        )
      ).length,
      0
    )
    const wrong = await client(O)
      .storage.from('listing-images-private')
      .upload(
        [...objectPaths].find((p) => p.includes('/' + draftId + '/')),
        files[1].bytes,
        { contentType: 'image/png', upsert: false }
      )
    assert(wrong.error)
    pass(
      'Actual RLS hides unpublished Listing/image metadata; other/anonymous cannot mutate/finalize/recover; bad signature and invalid slots rejected'
    )
    const [privateImage] = await ok(
      client(S)
        .from('listing_images')
        .select('id,path,storage_bucket')
        .eq('listing_id', draftId)
    )
    assert.equal(privateImage.storage_bucket, 'listing-images-private')
    assert((await imageRead(S, privateImage.id, 200)).equals(files[0].bytes))
    await imageRead(B, privateImage.id, 404)
    await imageRead(N, privateImage.id, 404)
    await directProbes(
      client(S),
      client(O),
      privateImage.path,
      files[0].bytes,
      'draft'
    )
    const forgedBucket = await client(S)
      .from('listing_images')
      .update({ storage_bucket: 'listing-images' })
      .eq('id', privateImage.id)
    assert(forgedBucket.error)
    const forgedInsert = await client(S).from('listing_images').insert({
      listing_id: draftId,
      slot: 1,
      storage_bucket: 'listing-images',
    })
    assert(forgedInsert.error)
    assert.equal(
      (
        await ok(
          client(S)
            .from('listing_images')
            .select('storage_bucket')
            .eq('id', privateImage.id)
            .single()
        )
      ).storage_bucket,
      'listing-images-private'
    )
    pass(
      'Draft owner API bytes; anon/other uniform 404 and cache prevention; real download/public/transform routes deny unauthorized bytes; source bucket forgery denied'
    )
    step = 'edit, favorites persistence, sold and channel guard'
    const oldUrls = normal.listing.photoUrls.slice()
    const edited = await call(
      S,
      'listings',
      'PATCH',
      { segments: [normalId] },
      { title: 'B05 ' + runId + ' edited', price: 2600 }
    )
    assert.equal(edited.id, normalId)
    assert.deepEqual(edited.photoUrls, oldUrls)
    assert.equal(
      (await call(B, 'favorites', 'POST', { segments: [normalId] })).favorited,
      true
    )
    assert.equal(
      (await call(B, 'favorites', 'POST', { segments: [normalId] })).favorited,
      true
    )
    const freshBuyer = device()
    await call(
      freshBuyer,
      'auth',
      'POST',
      { action: 'sign-in' },
      { email: buyer.email, password: buyer.password }
    )
    assert.equal(
      (await call(freshBuyer, 'favorites', 'GET', { segments: [normalId] }))
        .favorited,
      true
    )
    assert(
      (await call(freshBuyer, 'favorites', 'GET', { channel: 'resale' })).some(
        (x) => x.id === normalId
      )
    )
    assert.equal(
      (await call(O, 'favorites', 'GET', { segments: [normalId] })).favorited,
      false
    )
    const forged = await client(O)
      .from('listing_favorites')
      .insert({ user_id: buyer.id, listing_id: normalId })
    assert(forged.error)
    await call(
      B,
      'listings',
      'POST',
      { segments: [normalId, 'sold'] },
      undefined,
      403
    )
    assert.equal(
      (await call(S, 'listings', 'POST', { segments: [normalId, 'sold'] }))
        .status,
      'sold'
    )
    assert.equal(
      await call(N, 'listings', 'GET', { segments: [normalId] }),
      null
    )
    assert(
      !(await call(freshBuyer, 'favorites', 'GET', { channel: 'resale' })).some(
        (x) => x.id === normalId
      )
    )
    await call(
      S,
      'listings',
      'PATCH',
      { segments: [normalId] },
      { title: 'B05 ' + runId + ' sold edit' },
      400
    )
    assert.equal(
      (await call(B, 'favorites', 'DELETE', { segments: [normalId] }))
        .favorited,
      false
    )
    await call(
      S,
      'listings',
      'POST',
      {},
      { ...input('forged-shop'), listingChannel: 'shop' },
      400
    )
    const channel = await client(S)
      .from('listings')
      .update({ listing_channel: 'shop' })
      .eq('id', draftId)
    assert(channel.error)
    assert.equal(
      (await ops.getCreationListing(draftId)).listingChannel,
      'resale'
    )
    pass(
      'Same-ID edit preserves images; favorites survive re-login and dedupe; cross-user favorite denial; owner-only Sold; Shop channel cannot be forged'
    )
    step = 'Discard through real local UI'
    await browserDiscard(S, files)
    pass(
      'Actual Create UI Discard on injected cleanup failure: empty reopen, no autosave, failed remote draft stays unpublished and traceable'
    )
    step = 'final visibility and historical URL checks'
    await imageRead(S, publicImages[0].id, 200)
    await imageRead(B, publicImages[0].id, 404)
    await imageRead(N, publicImages[0].id, 404)
    const legacy = query(
      "begin read only;select i.path from public.listing_images i join public.listings l on l.id=i.listing_id where i.storage_bucket='listing-images' and i.ready and l.published_at is not null and l.status='available' and l.listing_channel='resale' order by i.id limit 1;rollback;"
    )
    assert.equal(legacy.length, 1)
    const oldResponse = await fetch(
      origin + '/storage/v1/object/public/listing-images/' + legacy[0].path
    )
    assert(
      oldResponse.ok &&
        (oldResponse.headers.get('content-type') || '').startsWith('image/')
    )
    assert((await oldResponse.arrayBuffer()).byteLength > 0)
    const copies = query(
      `begin read only;select count(*) count from storage.objects where bucket_id='listing-images' and split_part(name,'/',1) in(${users
        .map((u) => "'" + u.id + "'")
        .join(',')});rollback;`
    )
    assert.equal(Number(copies[0].count), 0)
    pass(
      'Sold owner-only API access, historical public image still readable, no public copies of this run private images'
    )
    step = 'completed'
  } catch (error) {
    appLogs.push({
      step,
      errorName: error.name,
      location: error.stack?.split('\n')[1],
      assertion:
        error.code === 'ERR_ASSERTION'
          ? String(error.message).slice(0, 200)
          : undefined,
    })
    failed = true
    if (failed || !cleanupComplete) process.exitCode = 1
    save()
    throw Error('B05 acceptance stopped')
  } finally {
    try {
      await cleanupRun()
    } catch {
      failed = true
      cleanupComplete = false
      save()
    }
    await browser?.close()
    if (server) await new Promise((resolve) => server.close(resolve))
    console.warn = originalWarn
    console.error = originalError
    save()
    console.log(
      cleanupComplete
        ? 'PASS exact-run cleanup verified; no fixture account/listing/favorite/image residue'
        : 'FAIL cleanup incomplete; consult exact resource IDs in journal'
    )
  }
}
async function browserDiscard(S, files) {
  const { root, build } = require('./message-payload.browser.cjs')
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  delete aliases['@/lib/listings-api']
  const stub = path.join(root, 'b05-hooks.js')
  fs.writeFileSync(
    stub,
    'export function useMessageSeller(){return {contact(){},busy:false}};export function useListingOfferContext(){return {enabled:false}}'
  )
  aliases['@/hooks/use-message-seller'] = stub
  aliases['@/components/listings/use-listing-offer-context'] = stub
  aliases['./use-listing-offer-context'] = stub
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `import 'tailwindcss/src/css/preflight.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{MarketplaceSessionProvider}from'@/components/listings/marketplace-session';import{ListingCreationSheet}from'@/components/listings/listing-creation-sheet';function App(){const[open,setOpen]=useState(false);return <LazyMotion features={domAnimation}><MarketplaceSessionProvider><button onClick={()=>setOpen(true)}>Open B05 Create</button>{open&&<ListingCreationSheet mode="resale" onClose={()=>setOpen(false)} onSaved={()=>setOpen(false)} onGuardChange={()=>{}}/>}</MarketplaceSessionProvider></LazyMotion>};createRoot(document.getElementById('root')).render(<App/>);`
  )
  fs.writeFileSync(
    path.join(root, 'index.html'),
    `<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#fff;font-family:Arial}</style><script>window.process={env:{NEXT_PUBLIC_MESSAGES_ENV:'staging',NEXT_PUBLIC_SUPABASE_URL:'${origin}'}}</script><div id="root"></div><script src="/bundle.js"></script>`
  )
  await build(aliases)
  const http = require('node:http')
  server = http.createServer(async (req, res) => {
    res.status = (n) => {
      res.statusCode = n
      return res
    }
    res.send = (b) => res.end(b)
    res.json = (b) => {
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(b))
    }
    try {
      const u = new URL(req.url, 'http://localhost')
      if (u.pathname === '/' || u.pathname === '/bundle.js') {
        res.setHeader(
          'Content-Type',
          u.pathname === '/' ? 'text/html' : 'application/javascript'
        )
        return res.end(
          fs.readFileSync(
            path.join(root, u.pathname === '/' ? 'index.html' : 'bundle.js')
          )
        )
      }
      req.query = Object.fromEntries(u.searchParams)
      let kind
      if (u.pathname.startsWith('/api/auth/')) {
        kind = 'auth'
        req.query.action = u.pathname.split('/').pop()
      } else if (u.pathname.startsWith('/api/listing-media/')) {
        kind = 'media'
        req.query.imageId = u.pathname.split('/').pop()
      } else if (u.pathname.startsWith('/api/listing-images/')) {
        kind = 'images'
        req.query.id = u.pathname.split('/').pop()
      } else if (u.pathname.startsWith('/api/listings')) {
        kind = 'listings'
        req.query.segments = u.pathname
          .slice('/api/listings'.length)
          .split('/')
          .filter(Boolean)
      }
      if (!kind) return res.status(404).json({ error: 'Not found' })
      if (!['images', 'media'].includes(kind) && req.method !== 'GET') {
        const chunks = []
        for await (const chunk of req) chunks.push(chunk)
        const bytes = Buffer.concat(chunks)
        req.body = bytes.length ? JSON.parse(bytes) : {}
      }
      await handlers[kind](req, res)
    } catch {
      if (!res.writableEnded)
        res.status(500).json({ error: 'Local harness request failed' })
    }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const local = 'http://127.0.0.1:' + server.address().port
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    serviceWorkers: 'block',
  })
  const login = await ctx.request.post(local + '/api/auth/sign-in', {
    headers: { Origin: local, 'X-Marketplace-Request': '1' },
    data: { email: users[0].email, password: users[0].password },
  })
  assert.equal(login.status(), 200)
  const page = await ctx.newPage(),
    consoleRecords = []
  await page.route(/^https?:/, (r) =>
    new URL(r.request().url()).origin === local ? r.continue() : r.abort()
  )
  page.on('console', (m) => {
    if (m.text().includes('Listing draft cleanup unconfirmed after Discard'))
      consoleRecords.push(m.text())
  })
  await page.goto(local)
  await page
    .getByRole('button', { name: 'Open B05 Create', exact: true })
    .click()
  const sheet = page.getByRole('dialog', { name: 'Create Resale', exact: true })
  const photo = {
    name: 'b05.jpeg',
    mimeType: 'image/jpeg',
    buffer: files[0].bytes,
  }
  await sheet.locator('input[type=file]').setInputFiles(photo)
  const next = async (n) => {
    await sheet.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.waitForFunction(
      (n) =>
        document
          .querySelector('[data-multi-step-form]')
          ?.getAttribute('data-multi-step-form') === String(n),
      n
    )
    await page.waitForTimeout(650)
  }
  await next(1)
  await sheet
    .getByRole('textbox', { name: 'Title', exact: true })
    .fill('B05 ' + runId + ' browser-discard')
  await sheet.locator('input[name=price]').fill('25.00')
  const select = async (label, value) => {
    await sheet.getByRole('combobox', { name: label, exact: true }).click()
    await page.getByRole('option', { name: value, exact: true }).click()
    await page.waitForTimeout(180)
  }
  await select('Condition', 'Good')
  await select('Category', 'Electronics')
  await select('Subcategory', 'Cameras')
  await next(2)
  await sheet
    .getByRole('combobox', { name: /Meeting location/ })
    .fill('B05 acceptance meeting location')
  await next(3)
  await sheet.getByRole('radio', { name: /Arrange Payment Directly/ }).check()
  await next(4)
  const before = new Set(listings.keys())
  fault = { kind: 'reject-upload' }
  await sheet
    .getByRole('button', { name: 'Confirm & Publish', exact: true })
    .click()
  await sheet
    .getByRole('alert')
    .filter({ hasText: /Continue publication/ })
    .waitFor()
  const added = [...listings.keys()].filter((id) => !before.has(id))
  assert.equal(added.length, 1)
  const id = added[0]
  fault = { kind: 'reject-abandon', id }
  await sheet
    .getByRole('button', { name: 'Close Create Resale', exact: true })
    .click()
  await page
    .getByRole('dialog', { name: 'Discard this listing?', exact: true })
    .getByRole('button', { name: 'Discard', exact: true })
    .click()
  await sheet.waitFor({ state: 'detached' })
  assert.equal(
    await call(device(), 'listings', 'GET', { segments: [id] }),
    null
  )
  assert.equal((await list(S).getCreationListing(id)).publishedAt, null)
  assert(appLogs.some((x) => x.listingId === id && x.status === 503))
  assert.equal(consoleRecords.length, 1)
  await page
    .getByRole('button', { name: 'Open B05 Create', exact: true })
    .click()
  await sheet.waitFor()
  assert.equal(
    await sheet.locator('form').getAttribute('data-photo-count'),
    '0'
  )
  assert.equal(
    await sheet
      .locator('[data-multi-step-form]')
      .getAttribute('data-multi-step-form'),
    '0'
  )
  await page.screenshot({
    path: path.join(folder, 'discard-fresh-create-1280.png'),
  })
  await sheet.locator('input[type=file]').setInputFiles(photo)
  await next(1)
  assert.equal(
    await sheet
      .getByRole('textbox', { name: 'Title', exact: true })
      .inputValue(),
    ''
  )
  assert.equal(listings.size, before.size + 1)
  assert(
    !(await page.evaluate(() =>
      Object.keys(localStorage).some((k) => /draft|publication/i.test(k))
    ))
  )
  await ctx.close()
}
main().catch(() => {
  console.warn = originalWarn
  console.error = originalError
  console.error(
    'B05 stopped at ' +
      step +
      '; sanitized evidence: ' +
      path.join(folder, 'result.json')
  )
  process.exitCode = 1
})
