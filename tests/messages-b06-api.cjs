// Actual image finalize route: failed signing after commit must retry same ID.
const fs = require('node:fs'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
const id = '11111111-1111-4111-8111-111111111111'
class ApiError extends Error {
  constructor(message, status = 400) {
    super(message)
    this.status = status
  }
}
let authenticated = true,
  participant = true,
  failSigning = true,
  committed = false,
  finalizeCalls = 0,
  abandonCalls = 0,
  presentations = 0
const canonical = { id, type: 'IMAGE', conversation_id: id, image_count: 1 }
const mocks = {
  '@/lib/listing-validation': { ListingApiError: ApiError },
  '@/lib/server/chat-image-storage': { requireImageEnvironment: () => {} },
  '@/lib/server/marketplace-auth': {
    requireMarketplaceUser: async () => {
      if (!authenticated) throw new ApiError('Unauthorized', 401)
      return { id }
    },
    requireSameOriginWrite: (req) => {
      if (req.headers['x-marketplace-request'] !== '1')
        throw new ApiError('Invalid request', 403)
    },
  },
  '@/lib/server/message-image-service': {
    ownedSubmission: async () => {
      if (!participant) throw new ApiError('Image submission not found.', 404)
      return { id }
    },
    abandonImages: async () => {
      abandonCalls++
    },
    imageError: (error) => {
      if (error) throw new ApiError('Failure', 503)
    },
    imagePresentation: (x) => x,
    signMessageImages: async () => [],
  },
  '@/lib/server/supabase-messages-repository': {
    messageUuid: (value) => {
      if (value !== id) throw new ApiError('Invalid ID')
      return value
    },
    createSupabaseMessagesRepository: () => ({
      present: async (rows) => {
        presentations++
        assert(committed)
        assert.equal(rows[0].id, id)
        if (failSigning) throw new ApiError('Signing unavailable', 503)
        return [
          {
            id,
            type: 'IMAGE',
            images: [{ id: 'image', previewUrl: 'fixture-only' }],
          },
        ]
      },
    }),
  },
  '@/lib/supabase/server': {
    createMarketplaceClient: () => ({
      rpc: async (name, args) => {
        assert.equal(name, 'marketplace_finalize_image_message')
        assert.equal(args.p_submission_id, id)
        finalizeCalls++
        committed = true
        return { data: canonical, error: null }
      },
    }),
  },
}
const code = ts.transpileModule(
  fs.readFileSync('pages/api/messages/images/[[...segments]].ts', 'utf8'),
  { compilerOptions: { module: 1, target: 7 } }
).outputText
const moduleRoute = { exports: {} }
new Function('require', 'module', 'exports', code)(
  (name) => {
    assert(mocks[name], name)
    return mocks[name]
  },
  moduleRoute,
  moduleRoute.exports
)
const handler = moduleRoute.exports.default
async function call({
  method = 'POST',
  headers = { 'x-marketplace-request': '1' },
  body = {},
  segments = [id, 'finalize'],
} = {}) {
  const response = {
    headers: {},
    setHeader(k, v) {
      this.headers[k] = v
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
  await handler({ method, headers, body, query: { segments } }, response)
  assert.match(response.headers['Cache-Control'], /private, no-store/)
  return response
}
async function main() {
  global.fetch = async () => {
    throw Error('Network forbidden')
  }
  authenticated = false
  assert.equal((await call()).code, 401)
  assert.equal(finalizeCalls, 0)
  authenticated = true
  participant = false
  assert.equal((await call()).code, 404)
  assert.equal(finalizeCalls, 0)
  participant = true
  assert.equal((await call({ headers: {} })).code, 403)
  assert.equal(finalizeCalls, 0)
  assert.equal((await call({ body: { senderId: id } })).code, 400)
  assert.equal(finalizeCalls, 0)
  const failed = await call()
  assert.equal(failed.code, 503)
  assert(committed)
  assert.equal(abandonCalls, 0)
  assert.equal(finalizeCalls, 1)
  failSigning = false
  const success = await call()
  assert.equal(success.code, 200)
  assert.equal(success.body.id, id)
  assert.equal(finalizeCalls, 2)
  assert.equal(abandonCalls, 0)
  assert.equal(presentations, 2)
  assert.equal((await call({ method: 'DELETE' })).code, 405)
  // Actual signing service: no RLS-visible metadata => no privileged signing.
  let privileged = 0,
    visible = [],
    signingFails = false
  const serviceMocks = {
    crypto: require('node:crypto'),
    '@/lib/listing-images': {},
    '@/lib/listing-validation': { ListingApiError: ApiError },
    '@/lib/server/chat-image-storage': {
      requireImageEnvironment: () => {},
      createChatStorage: () => {
        privileged++
        return {
          storage: {
            from(bucket) {
              assert.equal(bucket, 'chat-images')
              return {
                createSignedUrls: async (paths, ttl) => {
                  assert.deepEqual(
                    paths,
                    visible.map((x) => x.storage_path)
                  )
                  assert.equal(ttl, 300)
                  return signingFails
                    ? { error: {} }
                    : {
                        data: paths.map(() => ({
                          signedUrl: 'private-fixture-url',
                        })),
                        error: null,
                      }
                },
              }
            },
          },
        }
      },
    },
    '@/lib/server/marketplace-auth': {
      requireMarketplaceUser: async () => ({ id }),
    },
    '@/lib/server/messages-environment': {
      messageUuid: (value) => {
        assert.equal(value, id)
        return value
      },
    },
  }
  const serviceCode = ts.transpileModule(
    fs.readFileSync('lib/server/message-image-service.ts', 'utf8'),
    { compilerOptions: { module: 1, target: 7 } }
  ).outputText
  const serviceModule = { exports: {} }
  new Function('require', 'module', 'exports', serviceCode)(
    (name) => {
      assert(serviceMocks[name], name)
      return serviceMocks[name]
    },
    serviceModule,
    serviceModule.exports
  )
  const query = {
    select() {
      return this
    },
    in(key, ids) {
      assert.equal(key, 'message_id')
      assert.deepEqual(ids, [id])
      return this
    },
    async order() {
      return { data: visible, error: null }
    },
  }
  const client = {
    from(table) {
      assert.equal(table, 'message_images')
      return query
    },
  }
  const sign = () => serviceModule.exports.signMessageImages(client, [id])
  assert.deepEqual(await sign(), [])
  assert.equal(privileged, 0)
  visible = [
    {
      message_id: id,
      id,
      storage_path: 'derived/from/rls',
      original_name: 'photo.png',
      size_bytes: 100,
      mime_type: 'image/png',
    },
  ]
  const signed = await sign()
  assert.equal(signed[0].previewUrl, 'private-fixture-url')
  assert(Date.parse(signed[0].expiresAt) > Date.now())
  signingFails = true
  await assert.rejects(sign(), (error) => error.status === 503)
  console.log(
    'PASS B06 actual APIs: authentication/origin/outsider/field guards, post-commit signing failure retains send and retries canonical ID, no abandon, RLS-derived-only short-lived signed media; zero network'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
