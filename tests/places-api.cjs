// Offline provider and session contracts only. Never loads local keys or sends requests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
let loggedIn = true
const auth = {
  requireSameOriginWrite(req) {
    if (
      req.headers['x-marketplace-request'] !== '1' ||
      req.headers.origin !== 'http://localhost:3000'
    )
      throw new (load('lib/listing-validation.ts').ListingApiError)(
        'Invalid origin.',
        403
      )
  },
  async requireMarketplaceUser() {
    if (!loggedIn)
      throw new (load('lib/listing-validation.ts').ListingApiError)(
        'Log in.',
        401
      )
    return { id: 'fixture-user' }
  },
}
function load(file) {
  const p = path.resolve(file)
  if (cache.has(p)) return cache.get(p)
  const m = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(p, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    }).outputText
  )(
    (name) => {
      if (name === '@/lib/server/marketplace-auth') return auth
      if (name === '@/lib/supabase/server')
        return {
          createMarketplaceClient() {
            return {}
          },
        }
      return name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)
    },
    m,
    m.exports
  )
  cache.set(p, m.exports)
  return m.exports
}
const service = load('lib/server/places-service.ts'),
  handler = load('pages/api/places/[action].ts').default
const token = '11111111-1111-4111-8111-111111111111',
  key = 'offline-places-key-sentinel'
process.env.APP_ENV = 'staging'
process.env.NEXT_PUBLIC_SUPABASE_URL =
  'https://pcaqxezdfxofysghssyo.supabase.co'
process.env.GOOGLE_PLACES_API_KEY = key
let calls = []
let failure = false
global.fetch = async (url, opts) => {
  calls.push({ url, opts })
  if (failure) return new Response('private upstream ' + key, { status: 403 })
  return new Response(
    JSON.stringify(
      url.includes('places:autocomplete')
        ? {
            suggestions: [
              {
                placePrediction: {
                  placeId: 'fixture_1',
                  text: { text: 'Fixture full address' },
                  structuredFormat: {
                    mainText: { text: 'Fixture' },
                    secondaryText: { text: 'London, ON' },
                  },
                },
                private: 'not forwarded',
              },
            ],
            raw: key,
          }
        : {
            id: 'fixture_1',
            displayName: { text: 'Fixture' },
            formattedAddress: 'Fixture address',
            raw: key,
            location: { latitude: 1, longitude: 2 },
          }
    ),
    { status: 200 }
  )
}
async function invoke(action, body, extra = {}) {
  const headers = {},
    res = {
      code: 200,
      setHeader(k, v) {
        headers[k] = v
        return this
      },
      status(n) {
        this.code = n
        return this
      },
      json(data) {
        this.data = data
        return this
      },
    }
  await handler(
    {
      method: 'POST',
      query: { action },
      headers: {
        host: 'localhost:3000',
        origin: 'http://localhost:3000',
        'x-marketplace-request': '1',
      },
      body,
      ...extra,
    },
    res
  )
  assert.equal(headers['Cache-Control'], 'private, no-store')
  assert(!JSON.stringify(res.data).includes(key))
  return res
}
(async () => {
  assert.equal(
    (
      await invoke(
        'autocomplete',
        { input: 'Western', sessionToken: token },
        { method: 'GET' }
      )
    ).code,
    405
  )
  for (const body of [
    { input: '', sessionToken: token },
    { input: 'UCC', sessionToken: 'bad' },
    { input: 'x'.repeat(161), sessionToken: token },
    { input: 'UCC', sessionToken: token, userId: 'forged' },
  ])
    assert.equal((await invoke('autocomplete', body)).code, 400)
  assert.equal(calls.length, 0)
  loggedIn = false
  assert.equal(
    (await invoke('autocomplete', { input: 'UCC', sessionToken: token })).code,
    401
  )
  loggedIn = true
  assert.equal(
    (
      await invoke(
        'autocomplete',
        { input: 'UCC', sessionToken: token },
        { headers: { origin: 'https://other.invalid' } }
      )
    ).code,
    403
  )
  let r = await invoke('autocomplete', {
    input: 'Western',
    sessionToken: token,
  })
  assert.equal(r.code, 200)
  assert.deepEqual(r.data, {
    suggestions: [
      {
        placeId: 'fixture_1',
        primaryText: 'Fixture',
        secondaryText: 'London, ON',
        displayText: 'Fixture full address',
      },
    ],
  })
  const input = JSON.parse(calls[0].opts.body)
  assert.deepEqual(input.includedRegionCodes, ['ca'])
  assert.equal(input.sessionToken, token)
  assert.equal(calls[0].opts.headers['X-Goog-Api-Key'], key)
  assert.equal(calls[0].opts.cache, 'no-store')
  r = await invoke('details', { placeId: 'fixture_1', sessionToken: token })
  assert.deepEqual(r.data, {
    placeId: 'fixture_1',
    displayName: 'Fixture',
    formattedAddress: 'Fixture address',
  })
  assert(calls[1].url.includes(token))
  assert.equal(
    calls[1].opts.headers['X-Goog-FieldMask'],
    'id,displayName,formattedAddress'
  )
  assert.equal(
    (await invoke('details', { placeId: '../../secret', sessionToken: token }))
      .code,
    400
  )
  failure = true
  assert.equal(
    (await invoke('autocomplete', { input: 'Western', sessionToken: token }))
      .code,
    503
  )
  process.env.APP_ENV = 'production'
  const before = calls.length
  assert.equal(
    (await invoke('autocomplete', { input: 'Western', sessionToken: token }))
      .code,
    503
  )
  assert.equal(calls.length, before)
  process.env.APP_ENV = 'staging'
  for (let i = 0; i < 60; i++) service.guardPlacesRate('rate-fixture', 1000)
  assert.throws(
    () => service.guardPlacesRate('rate-fixture', 1001),
    (e) => e.status === 429
  )
  service.guardPlacesRate('rate-fixture', 61001)
  console.log(
    'PASS Places method/origin/auth/staging/body/token/place ID guards, minimal DTOs, Canada bias, matching session token, field masks, sanitized upstream errors, key non-disclosure, bounded rate safeguard; zero network.'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
