// Repository qualification with a synthetic RLS client; no network/database.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const listingId = '11111111-1111-4111-8111-111111111111'
let actor = 'buyer',
  status = 'sold',
  rpcCalls = 0,
  expectedRpc = 'marketplace_find_or_create_conversation',
  authFailure = false
const rows = [
  {
    id: 'existing',
    buyer_id: 'buyer',
    seller_id: 'seller',
    listing_origin_id: listingId,
    listing_id: listingId,
    listing_title_snapshot: 'Fixture',
    listing_price_cents_snapshot: 8000,
    listing_currency_snapshot: 'CAD',
    listing_category_snapshot: 'Electronics',
    buyer_last_read_sequence: 0,
    last_message_sequence: 0,
  },
]
const client = {
  from(table) {
    const filters = []
    const chain = {
      select() {
        return chain
      },
      eq(key, value) {
        filters.push([key, value])
        return chain
      },
      not() {
        return chain
      },
      order() {
        return chain
      },
      limit() {
        return chain
      },
      gt() {
        return chain
      },
      neq() {
        return chain
      },
      result() {
        return {
          data:
            table === 'conversations'
              ? rows.filter(
                  (r) =>
                    r.buyer_id === actor &&
                    filters.every(([k, v]) => r[k] === v)
                )
              : table === 'profiles'
              ? [{ display_name: 'Seller' }]
              : table === 'listings'
              ? [{ status, photoUrls: [] }]
              : [],
          error: null,
          count: 0,
        }
      },
      async maybeSingle() {
        const r = chain.result()
        return { ...r, data: r.data[0] || null }
      },
      then(resolve, reject) {
        return Promise.resolve(chain.result()).then(resolve, reject)
      },
    }
    return chain
  },
  storage: {
    from() {
      return {
        getPublicUrl() {
          return { data: { publicUrl: '' } }
        },
      }
    },
  },
  async rpc(name) {
    rpcCalls++
    assert.equal(name, expectedRpc)
    if (status !== 'available')
      return { error: { code: '23514', message: 'Unavailable' } }
    return {
      data: { ...rows[0], id: 'new-own-thread', buyer_id: actor },
      error: null,
    }
  },
}
const moduleUnderTest = { exports: {} }
const source = ts.transpileModule(
  fs.readFileSync('lib/server/supabase-messages-repository.ts', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText
new Function('require', 'module', 'exports', source)(
  (name) => {
    if (name.endsWith('/listing-validation'))
      return {
        ListingApiError: class extends Error {
          constructor(message, status) {
            super(message)
            this.status = status
          }
        },
      }
    if (name.endsWith('/marketplace-auth'))
      return {
        requireMarketplaceUser: async () => {
          if (authFailure) throw Error('Unauthenticated')
          return { id: actor }
        },
      }
    if (name.endsWith('/server'))
      return { createMarketplaceClient: () => client }
    if (name.endsWith('/listing-mapper')) return { mapListing: (r) => r }
    if (name.endsWith('/chat-image-storage'))
      return { imageSendingEnabled: () => true }
    if (name.endsWith('/messages-environment'))
      return {
        requireMessagesEnvironment() {},
        messageUuid: (v) => {
          assert.equal(v, listingId)
          return v
        },
      }
    return {}
  },
  moduleUnderTest,
  moduleUnderTest.exports
)
async function run() {
  for (status of ['pending', 'reserved', 'sold', 'available']) {
    actor = 'buyer'
    const before = rpcCalls
    const repo = moduleUnderTest.exports.createSupabaseMessagesRepository({})
    const result = await repo.findOrCreate(listingId)
    assert.equal(result.id, 'existing')
    assert.equal(result.role, 'buying')
    assert.equal(rpcCalls, before)
    assert.equal((await repo.findOrCreate(listingId, true)).id, 'existing')
    assert.equal(rpcCalls, before)
  }
  actor = 'other-buyer'
  status = 'sold'
  await assert.rejects(() =>
    moduleUnderTest.exports
      .createSupabaseMessagesRepository({})
      .findOrCreate(listingId)
  )
  status = 'available'
  assert.equal(
    (
      await moduleUnderTest.exports
        .createSupabaseMessagesRepository({})
        .findOrCreate(listingId)
    ).id,
    'new-own-thread'
  )
  expectedRpc = 'marketplace_contact_seller'
  assert.equal(
    (
      await moduleUnderTest.exports
        .createSupabaseMessagesRepository({})
        .findOrCreate(listingId, true)
    ).id,
    'new-own-thread'
  )
  authFailure = true
  const before = rpcCalls
  await assert.rejects(() =>
    moduleUnderTest.exports
      .createSupabaseMessagesRepository({})
      .findOrCreate(listingId)
  )
  assert.equal(rpcCalls, before)
  assert.equal(rows.length, 1)
  console.log(
    'PASS authenticated existing-thread reuse on unavailable Listings; other Buyer cannot enter; new thread retains RPC availability gate; no network.'
  )
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
