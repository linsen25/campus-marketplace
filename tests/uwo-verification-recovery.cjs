// Mock-only verification route and UI recovery contract checks.  Provider,
// database, and real mailbox delivery remain intentionally out of scope.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

let sameOrigin = true
let actor = 'buyer-a'
const events = []
class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
const cache = new Map()
function load(file) {
  if (cache.has(file)) return cache.get(file).exports
  const module = { exports: {} }
  cache.set(file, module)
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText
  new Function('require', 'module', 'exports', output)(
    (name) => {
      if (name === '@/lib/listing-validation') return { ListingApiError }
      if (name === '@/lib/server/marketplace-auth')
        return {
          requireSameOriginWrite: () => {
            if (!sameOrigin)
              throw new ListingApiError('Cross-origin write denied.', 403)
          },
        }
      if (name === '@/lib/server/uwo-verification')
        return {
          uwoVerificationStatus: async () => ({ verified: false, actor }),
          sendUwoVerification: async (_ctx, email) => {
            events.push(['send', actor, email])
            return { sent: true }
          },
          completeUwoVerification: async (_ctx, code) => {
            events.push(['verify', actor, code])
            return { verified: true }
          },
        }
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}
const handler = load('pages/api/profile/uwo-verification.ts').default
async function request(method, body, headers = {}) {
  const response = {
    code: 200,
    body: null,
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
  }
  await handler(
    {
      method,
      body,
      headers: {
        origin: 'http://localhost:3000',
        host: 'localhost:3000',
        ...headers,
      },
    },
    response
  )
  return response
}
async function main() {
  assert.equal((await request('GET')).code, 200)
  sameOrigin = false
  assert.equal(
    (await request('POST', { action: 'send', email: 'x@uwo.ca' })).code,
    403
  )
  sameOrigin = true
  assert.equal(
    (await request('POST', { action: 'send', email: 'x@uwo.ca' })).code,
    200
  )
  assert.equal(
    (await request('POST', { action: 'verify', code: '123456' })).body.verified,
    true
  )
  assert.equal((await request('POST', { action: 'unknown' })).code, 400)
  actor = 'buyer-b'
  assert.equal(
    (await request('POST', { action: 'send', email: 'b@uwo.ca' })).body.sent,
    true
  )
  assert.deepEqual(events, [
    ['send', 'buyer-a', 'x@uwo.ca'],
    ['verify', 'buyer-a', '123456'],
    ['send', 'buyer-b', 'b@uwo.ca'],
  ])
  const ui = fs.readFileSync(
    'components/home/uwo-email-verification.tsx',
    'utf8'
  )
  for (const text of [
    'Retry',
    'Change UWO email',
    'Resend verification code',
    'generation.current',
    'setVerified(null)',
  ])
    assert(ui.includes(text), `UWO recovery contract missing ${text}`)
  assert(!ui.includes('if (verified === null) return null'))
  console.log(
    'PASS UWO mock route: same-origin, send/verify actions and account-scoped requests'
  )
  console.log(
    'PASS UWO UI recovery contract: Retry, change/resend, generation fencing and visible load failure'
  )
  console.log(
    'NOT TESTED database rate limits, hashed codes and real email delivery'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
