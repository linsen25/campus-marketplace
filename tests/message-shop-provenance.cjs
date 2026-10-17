const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const m = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(
    fs.readFileSync('lib/conversation-provenance.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }
  ).outputText
)(() => ({ ListingApiError: class extends Error {} }), m, m.exports)
for (const channel of [undefined, null, 'resale'])
  assert.deepEqual(
    m.exports.conversationProvenance(channel, 'Ignored live Shop'),
    { channel: 'resale' }
  )
assert.deepEqual(m.exports.conversationProvenance('shop', 'Vintage Loop'), {
  channel: 'shop',
  shopName: 'Vintage Loop',
})
assert.throws(
  () => m.exports.conversationProvenance('shop', null),
  /provenance unavailable/
)
console.log(
  'PASS historical NULL/absent fallback, Resale no Shop source, frozen Shop mapping, missing-name rejection'
)
// Actual repository projection with RLS-hidden live Listing and controlled DB failure.
let liveError = null
const row = {
  id: 'thread',
  buyer_id: 'buyer',
  seller_id: 'seller',
  listing_id: 'listing',
  listing_origin_id: 'listing',
  listing_title_snapshot: 'Frozen title',
  listing_price_cents_snapshot: 8000,
  listing_currency_snapshot: 'CAD',
  listing_category_snapshot: 'Electronics',
  listing_channel_snapshot: 'shop',
  shop_name_snapshot: 'Vintage Loop',
  last_message_sequence: 0,
  buyer_last_read_sequence: 0,
  seller_last_read_sequence: 0,
}
const client = {
  from(table) {
    let proxy
    const value = () =>
      table === 'conversations'
        ? { data: row, error: null }
        : table === 'profiles'
        ? { data: { display_name: 'Current person' }, error: null }
        : table === 'listings'
        ? { data: null, error: liveError }
        : { data: [], count: 0, error: null }
    proxy = new Proxy(
      {},
      {
        get: (_, key) =>
          key === 'then'
            ? (resolve, reject) =>
                Promise.resolve(value()).then(resolve, reject)
            : () => proxy,
      }
    )
    return proxy
  },
  rpc() {
    throw Error('Reuse must not call create RPC')
  },
}
const repo = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(
    fs.readFileSync('lib/server/supabase-messages-repository.ts', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
      },
    }
  ).outputText
)(
  (name) =>
    name.endsWith('conversation-provenance')
      ? m.exports
      : name.endsWith('listing-validation')
      ? { ListingApiError: class extends Error {} }
      : name.endsWith('marketplace-auth')
      ? { requireMarketplaceUser: async () => ({ id: 'buyer' }) }
      : name.endsWith('messages-environment')
      ? { requireMessagesEnvironment: () => {}, messageUuid: (v) => v }
      : name.endsWith('supabase/server')
      ? { createMarketplaceClient: () => client }
      : name.endsWith('chat-image-storage')
      ? { imageSendingEnabled: () => false }
      : {},
  repo,
  repo.exports
)
;(async () => {
  const r = repo.exports.createSupabaseMessagesRepository({})
  let c = await r.detail('thread')
  assert.deepEqual(c.listing.provenance, {
    channel: 'shop',
    shopName: 'Vintage Loop',
  })
  assert.equal(c.person.name, 'Current person')
  assert.equal(c.listing.title, 'Frozen title')
  assert.equal(c.listing.availability, 'unavailable')
  assert.equal(c.listing.live, undefined)
  assert.equal((await r.findOrCreate('listing', true)).id, 'thread')
  row.listing_channel_snapshot = null
  row.shop_name_snapshot = null
  c = await r.detail('thread')
  assert.deepEqual(c.listing.provenance, { channel: 'resale' })
  liveError = { code: 'XX000' }
  await assert.rejects(() => r.detail('thread'))
  console.log(
    'PASS actual repository frozen provenance/live identity, hidden Listing fallback, reuse skips RPC, historical NULL mapping, infrastructure errors propagate'
  )
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
