const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

class ListingApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}

let authenticated = true
let sameOrigin = true
let receivingEmail = null
let verified = false
const calls = []
const client = {
  rpc: async (name, args) => {
    calls.push({ name, args })
    if (name === 'marketplace_get_interac_receiving_email_status')
      return {
        data: receivingEmail
          ? { email: receivingEmail, verified, verifiedAt: null }
          : null,
        error: null,
      }
    if (name === 'marketplace_set_interac_receiving_email') {
      receivingEmail = args.p_email
      verified = false
      return { data: receivingEmail, error: null }
    }
    throw Error(`Unexpected RPC: ${name}`)
  },
}

const deps = {
  '@/lib/interac-email': {
    normalizeInteracEmail(value) {
      const email = typeof value === 'string' ? value.trim().toLowerCase() : ''
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254
        ? email
        : null
    },
  },
  '@/lib/listing-validation': { ListingApiError },
  '@/lib/server/marketplace-auth': {
    requireMarketplaceUser: async () => {
      if (!authenticated) throw new ListingApiError('Unauthorized.', 401)
      return { id: 'owner' }
    },
    requireSameOriginWrite: () => {
      if (!sameOrigin) throw new ListingApiError('Invalid request.', 403)
    },
  },
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
}

function load(file) {
  const module = { exports: {} }
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText
  )((name) => deps[name], module, module.exports)
  return module.exports.default
}

const handler = load('pages/api/interac/settings.ts')

async function invoke(request) {
  const response = {
    headers: {},
    setHeader(key, value) {
      this.headers[key] = value
    },
    status(code) {
      this.code = code
      return this
    },
    json(body) {
      this.body = body
      return this
    },
  }
  await handler(request, response)
  assert.equal(response.headers['Cache-Control'], 'private, no-store')
  return response
}

;(async () => {
  let response = await invoke({ method: 'GET' })
  assert.equal(response.code, 200)
  assert.deepEqual(response.body, { receivingEmail: null, verified: false })

  response = await invoke({
    method: 'PUT',
    body: { receivingEmail: '  Seller@Example.ca ' },
  })
  assert.equal(response.code, 200)
  assert.deepEqual(response.body, {
    receivingEmail: 'seller@example.ca',
    verified: false,
  })
  assert.deepEqual(calls.at(-2), {
    name: 'marketplace_set_interac_receiving_email',
    args: { p_email: 'seller@example.ca' },
  })

  response = await invoke({
    method: 'PUT',
    body: { receivingEmail: 'not-email' },
  })
  assert.equal(response.code, 400)
  assert.equal(
    calls.at(-1).name,
    'marketplace_get_interac_receiving_email_status'
  )

  sameOrigin = false
  response = await invoke({
    method: 'PUT',
    body: { receivingEmail: 'seller@example.ca' },
  })
  assert.equal(response.code, 403)
  sameOrigin = true

  authenticated = false
  response = await invoke({ method: 'GET' })
  assert.equal(response.code, 401)
  authenticated = true

  response = await invoke({ method: 'DELETE' })
  assert.equal(response.code, 405)
  assert.equal(response.headers.Allow, 'GET, PUT')
  console.log(
    'PASS Interac settings API: owner-only read/save, normalization, CSRF, auth, method and no-store guards; zero network'
  )
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
