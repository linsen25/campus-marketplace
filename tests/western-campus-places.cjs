const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const cache = new Map()

function load(file) {
  const p = path.resolve(file)
  if (cache.has(p)) return cache.get(p)

  const m = { exports: {} }
  cache.set(p, m.exports)

  const source = fs.readFileSync(p, 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      esModuleInterop: true,
      resolveJsonModule: true,
    },
  }).outputText

  new Function('require', 'module', 'exports', compiled)(
    (name) => {
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts')

      if (name.startsWith('./') || name.startsWith('../')) {
        const resolved = path.resolve(path.dirname(p), name)
        if (resolved.endsWith('.json')) return require(resolved)
        if (resolved.endsWith('.ts')) return load(resolved)
      }

      return require(name)
    },
    m,
    m.exports
  )

  return m.exports
}

process.env.APP_ENV = 'uu'
process.env.NEXT_PUBLIC_SUPABASE_URL =
  'https://uqhyjpjiznpgomuizfqe.supabase.co'
process.env.GOOGLE_PLACES_API_KEY = 'offline-test-key'

const { assertMeetingPlaceSelection } = load('lib/server/places-service.ts')

let coordinates = {
  latitude: 43.0096,
  longitude: -81.2737,
}
let responseId = 'fixture_1'
let includeLocation = true

const originalFetch = global.fetch

global.fetch = async (_url, options) => {
  const mask = options.headers['X-Goog-FieldMask']

  assert.equal(mask, 'id,displayName,formattedAddress,location')

  return new Response(
    JSON.stringify({
      id: responseId,
      displayName: { text: 'Fixture Place' },
      formattedAddress: 'London, Ontario',
      ...(includeLocation ? { location: coordinates } : {}),
    }),
    { status: 200 }
  )
}

const reference = {
  label: 'Fixture Place',
  provider: 'google',
  placeId: 'fixture_1',
}

async function run() {
  const { isWithinWesternCampus } = load('lib/geo/western-campus.ts')

  assert.equal(isWithinWesternCampus(43.0096, -81.2737), true)
  assert.equal(isWithinWesternCampus(43.6532, -79.3832), false)

  await assertMeetingPlaceSelection('ON_CAMPUS', 'ON_CAMPUS', reference)

  coordinates = {
    latitude: 43.6532,
    longitude: -79.3832,
  }

  await assert.rejects(
    assertMeetingPlaceSelection('ON_CAMPUS', 'ON_CAMPUS', reference),
    (error) => error.status === 422
  )

  // OTHER requires coordinates and must be outside the campus boundary.
  await assertMeetingPlaceSelection('ON_CAMPUS', 'OTHER', reference)

  // An on-campus place cannot be selected as OTHER.
  coordinates = {
    latitude: 43.0096,
    longitude: -81.2737,
  }

  await assert.rejects(
    assertMeetingPlaceSelection('ON_CAMPUS', 'OTHER', reference),
    (error) => error.status === 422
  )

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        id: 'fixture_1',
        displayName: { text: 'Fixture Place' },
        formattedAddress: 'London, Ontario',
      }),
      { status: 200 }
    )

  includeLocation = false

  await assert.rejects(
    assertMeetingPlaceSelection('ON_CAMPUS', 'ON_CAMPUS', reference),
    (error) => error.status === 503
  )

  responseId = 'different_1'

  global.fetch = async () =>
    new Response(
      JSON.stringify({
        id: responseId,
        displayName: { text: 'Different Place' },
        formattedAddress: 'London, Ontario',
        location: {
          latitude: 43.0096,
          longitude: -81.2737,
        },
      }),
      { status: 200 }
    )

  await assert.rejects(
    assertMeetingPlaceSelection('ON_CAMPUS', 'ON_CAMPUS', reference),
    (error) => error.status === 400
  )

  console.log(
    'PASS Western campus geofence: inside, outside, Other, missing coordinates, mismatched Place ID; zero network.'
  )
}

run()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = originalFetch
  })
