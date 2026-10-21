// B03: actual image decoder and handlers; Storage/DB HTTP replaced, zero remote I/O.
/* global Blob */
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  sharp = require('sharp')
const owner = '11111111-1111-4111-8111-111111111111',
  other = '22222222-2222-4222-8222-222222222222'
const action = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  newer = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
let authenticated = true,
  current = null,
  uploadError = false,
  cleanupError = false,
  conflict = false,
  missing = false,
  race = false
let cleanupConstructorFailure = false,
  failAfterCommit = false
let calls = [],
  rpcImpl,
  blob
const repository = {
  client: {
    rpc: async (name, args) => {
      calls.push({ name, args })
      return rpcImpl(name, args)
    },
  },
  storage: {
    upload: async (p, bytes, options) => {
      calls.push({ upload: p, options })
      assert.equal(p, owner + '/' + action + '.webp')
      assert.equal(options.upsert, false)
      return { error: uploadError ? {} : null }
    },
    download: async (p) => {
      calls.push({ download: p })
      if (race) current = owner + '/' + newer + '.webp'
      return { data: missing ? null : blob, error: missing ? {} : null }
    },
    remove: async (paths) => {
      calls.push({ remove: paths })
      return { error: cleanupError ? {} : null }
    },
  },
}
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  cache.set(full, m.exports)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name === '@/lib/server/profile-avatar-repository')
        return {
          avatarDeadline: () => new AbortController().signal,
          requireAvatarEnvironment: () => {},
          avatarRepository: () => {
            if (cleanupConstructorFailure) throw Error('Cleanup unavailable')
            return repository
          },
          avatarDatabaseError: (error) => {
            if (error)
              throw new (load('lib/listing-validation.ts').ListingApiError)(
                'Safe error',
                error.code === '23505' ? 409 : 503
              )
          },
        }
      if (name === '@/lib/supabase/server')
        return { createMarketplaceClient: () => ({}) }
      if (name === '@/lib/server/marketplace-auth') {
        const actual = load('lib/server/marketplace-auth.ts')
        return {
          ...actual,
          requireMarketplaceUser: async () => {
            if (!authenticated)
              throw new (load('lib/listing-validation.ts').ListingApiError)(
                'Log in',
                401
              )
            return { id: owner }
          },
        }
      }
      if (name === '@supabase/supabase-js')
        return {
          createClient: () => ({
            from(table) {
              assert.equal(table, 'profiles')
              return {
                select(fields) {
                  assert.equal(fields, 'avatar_path')
                  return {
                    eq(key, id) {
                      assert.equal(key, 'id')
                      assert.equal(id, owner)
                      return {
                        maybeSingle: async () => ({
                          data: { avatar_path: current },
                          error: null,
                        }),
                      }
                    },
                  }
                },
              }
            },
          }),
        }
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
      return require(name)
    },
    m,
    m.exports
  )
  return m.exports
}
function reset() {
  calls = []
  current = null
  uploadError = false
  cleanupError = false
  conflict = false
  missing = false
  race = false
  authenticated = true
  cleanupConstructorFailure = false
  failAfterCommit = false
  rpcImpl = async (name) => {
    if (name === 'marketplace_prepare_profile_avatar')
      return {
        data: { complete: false, path: owner + '/' + action + '.webp' },
        error: null,
      }
    if (name === 'marketplace_commit_profile_avatar') {
      if (conflict) return { error: { code: '23505' } }
      current = owner + '/' + action + '.webp'
      if (failAfterCommit) cleanupConstructorFailure = true
      return { data: current, error: null }
    }
    if (name === 'marketplace_claim_profile_avatar_cleanup')
      return { data: [], error: null }
    if (name === 'marketplace_finish_profile_avatar_cleanup')
      return { data: null, error: null }
    throw Error('Unexpected RPC ' + name)
  }
}
function response() {
  return {
    code: 200,
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
    },
    status(n) {
      this.code = n
      return this
    },
    json(v) {
      this.body = v
      return this
    },
    send(v) {
      this.body = v
      return this
    },
    end() {
      return this
    },
  }
}
async function main() {
  const environmentKeys = [
    'APP_ENV',
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY',
  ]
  const previous = Object.fromEntries(
    environmentKeys.map((key) => [key, process.env[key]])
  )
  const actualRepository = load('lib/server/profile-avatar-repository.ts')
  const key = (role, ref) =>
    Buffer.from('{}').toString('base64url') +
    '.' +
    Buffer.from(JSON.stringify({ role, ref })).toString('base64url') +
    '.offline'
  try {
    process.env.APP_ENV = 'production'
    assert.throws(() => actualRepository.requireAvatarEnvironment())
    process.env.APP_ENV = 'staging'
    process.env.NEXT_PUBLIC_SUPABASE_URL =
      'https://pcaqxezdfxofysghssyo.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = key(
      'anon',
      'pcaqxezdfxofysghssyo'
    )
    process.env.SUPABASE_SERVICE_ROLE_KEY = key('service_role', 'wrong-project')
    assert.throws(() => actualRepository.requireAvatarEnvironment())
    process.env.SUPABASE_SERVICE_ROLE_KEY = key(
      'service_role',
      'pcaqxezdfxofysghssyo'
    )
    assert.equal(
      actualRepository.requireAvatarEnvironment(),
      process.env.SUPABASE_SERVICE_ROLE_KEY
    )
  } finally {
    for (const name of environmentKeys) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
  const service = load('lib/server/profile-avatar-service.ts'),
    upload = load('pages/api/profile/avatar.ts').default,
    read = load('pages/api/profile/avatar/[id].ts').default
  const raw = sharp({
    create: { width: 40, height: 32, channels: 3, background: '#44aa77' },
  })
  const png = await raw.clone().png().toBuffer()
  for (const [type, bytes] of [
    ['image/png', png],
    ['image/jpeg', await raw.clone().jpeg().toBuffer()],
    ['image/webp', await raw.clone().webp().toBuffer()],
  ]) {
    const decoded = await service.decodeAvatar(bytes, type),
      meta = await sharp(decoded.stored).metadata()
    assert.equal(meta.format, 'webp')
    assert(!meta.exif)
    assert.equal(meta.width, 40)
    assert.equal(meta.height, 32)
  }
  for (const [bytes, type] of [
    [Buffer.from('<svg/>'), 'image/svg+xml'],
    [png, 'image/jpeg'],
    [png.subarray(0, 18), 'image/png'],
    [Buffer.alloc(3 * 1024 * 1024 + 1), 'image/png'],
  ])
    await assert.rejects(service.decodeAvatar(bytes, type))
  const oriented = await raw
    .clone()
    .withMetadata({ orientation: 6 })
    .jpeg()
    .toBuffer()
  const orientedResult = await service.decodeAvatar(oriented, 'image/jpeg')
  const orientedMetadata = await sharp(orientedResult.stored).metadata()
  assert.equal(orientedMetadata.width, 32)
  assert.equal(orientedMetadata.height, 40)
  assert(!orientedMetadata.exif)
  const oversized = await sharp({
    create: { width: 4097, height: 1, channels: 3, background: 'white' },
  })
    .png()
    .toBuffer()
  await assert.rejects(service.decodeAvatar(oversized, 'image/png'))
  const apng = Buffer.concat([
    png.subarray(0, 33),
    Buffer.from([0, 0, 0, 8]),
    Buffer.from('acTL'),
    Buffer.alloc(12),
    png.subarray(33),
  ])
  await assert.rejects(service.decodeAvatar(apng, 'image/png'))
  const image = await service.decodeAvatar(png, 'image/png')
  blob = new Blob([image.stored], { type: 'image/webp' })
  function req(bytes = png, overrides = {}) {
    return {
      method: 'POST',
      query: {},
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
        'content-type': 'image/png',
        'x-avatar-action': action,
        'x-avatar-version': 'none',
        ...overrides,
      },
      async *[Symbol.asyncIterator]() {
        yield bytes
      },
    }
  }
  reset()
  let res = response()
  await upload(req(), res)
  assert.equal(res.code, 200)
  assert.deepEqual(res.body, {
    avatarUrl: `/api/profile/avatar/${owner}?v=${action}`,
    avatarVersion: action,
  })
  assert(!JSON.stringify(res.body).includes('source_sha256'))
  assert.equal(
    calls.find((c) => c.name === 'marketplace_prepare_profile_avatar').args
      .p_owner,
    owner
  )
  assert.equal(
    calls.find((c) => c.name === 'marketplace_prepare_profile_avatar').args
      .p_size,
    image.stored.length
  )
  reset()
  authenticated = false
  res = response()
  await upload(req(), res)
  assert.equal(res.code, 401)
  assert.equal(calls.length, 0)
  reset()
  res = response()
  await upload(req(png, { origin: 'https://evil.test' }), res)
  assert.equal(res.code, 403)
  assert.equal(calls.length, 0)
  reset()
  const forged = req()
  forged.query.ownerId = other
  res = response()
  await upload(forged, res)
  assert.equal(res.code, 400)
  assert.equal(calls.length, 0)
  reset()
  res = response()
  await upload(req(Buffer.alloc(3 * 1024 * 1024 + 1)), res)
  assert.equal(res.code, 413)
  assert.equal(calls.length, 0)
  reset()
  res = response()
  await upload(req(png, { 'content-length': String(3 * 1024 * 1024 + 1) }), res)
  assert.equal(res.code, 413)
  reset()
  uploadError = true
  missing = true
  res = response()
  await upload(req(), res)
  assert.equal(res.code, 503)
  assert.equal(current, null)
  assert(!calls.some((c) => c.name === 'marketplace_commit_profile_avatar'))
  reset()
  uploadError = true
  res = response()
  await upload(req(), res)
  assert.equal(
    res.code,
    200,
    'existing matching bytes recover an ambiguous upload'
  )
  reset()
  failAfterCommit = true
  res = response()
  await upload(req(), res)
  assert.equal(
    res.code,
    200,
    'cleanup initialization failure cannot fail a committed Save'
  )
  reset()
  conflict = true
  res = response()
  await upload(req(), res)
  assert.equal(res.code, 409)
  assert.equal(current, null)
  reset()
  rpcImpl = async (name) => {
    if (name === 'marketplace_prepare_profile_avatar')
      return {
        data: { complete: true, currentPath: owner + '/' + newer + '.webp' },
        error: null,
      }
    throw Error('Retry must not upload or commit')
  }
  res = response()
  await upload(req(), res)
  assert.equal(res.body.avatarVersion, newer)
  assert(!calls.some((c) => c.upload))
  reset()
  cleanupError = true
  rpcImpl = async (name) =>
    name === 'marketplace_claim_profile_avatar_cleanup'
      ? {
          data: [{ id: action, path: owner + '/' + action + '.webp' }],
          error: null,
        }
      : { data: null, error: null }
  await service.cleanupAvatars(owner, repository)
  assert(
    !calls.some((c) => c.name === 'marketplace_finish_profile_avatar_cleanup')
  )
  reset()
  current = owner + '/' + action + '.webp'
  res = response()
  await read({ method: 'GET', query: { id: owner, v: action } }, res)
  assert.equal(res.code, 200)
  assert.equal(res.headers['Content-Type'], 'image/webp')
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff')
  assert(Buffer.isBuffer(res.body))
  for (const query of [
    { id: owner, v: newer },
    { id: owner, v: action, path: 'arbitrary/path' },
    { id: '../../secret', v: action },
  ]) {
    calls = []
    res = response()
    await read({ method: 'GET', query }, res)
    assert.equal(res.code, 404)
    assert(!calls.some((c) => c.download))
  }
  race = true
  res = response()
  await read({ method: 'GET', query: { id: owner, v: action } }, res)
  assert.equal(res.code, 404, 'pointer rechecked after Storage await')
  console.log(
    'PASS B03: real JPEG/PNG/WebP decode/re-encode, SVG/animation/corruption/size/dimensions, authenticated raw-body API, CSRF/actor forgery, failed/ambiguous upload, stale/replayed intent, cleanup failure, canonical-only public media and replacement-read race; zero remote I/O.'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
