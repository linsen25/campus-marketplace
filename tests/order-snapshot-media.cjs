const assert = require('assert/strict'),
  fs = require('fs'),
  vm = require('vm'),
  ts = require('typescript'),
  crypto = require('crypto')
const sql = fs.readFileSync(
  'supabase/migrations/202610120003_order_snapshot_media.sql',
  'utf8'
)
assert(sql.includes("'order-snapshot-media',false"))
assert(!/create (?:or replace )?function .*accept/i.test(sql))
assert(!/update public\.(?:orders|order_requests|listings)/i.test(sql))
assert(!/(?:insert into|update|delete from) storage\.objects/i.test(sql))
assert(sql.includes('revoke all on'))
assert(sql.includes('for update'))
assert(sql.includes("state='delete_claimed'"))
assert(sql.includes("state='bound'"))
assert(sql.includes('Tombstones'))
assert(sql.includes('num_nonnulls(mime_type,size_bytes,sha256)=3'))
const source = fs.readFileSync('lib/server/order-snapshot-media.ts', 'utf8')
assert(source.includes('upsert: false'))
assert(source.includes("process.env.APP_ENV !== 'staging'"))
assert(source.includes("'https://pcaqxezdfxofysghssyo.supabase.co'"))
assert(!source.includes('SUPABASE_SERVICE_ROLE_KEY'))
const code = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2020,
  },
}).outputText
const input = fs.readFileSync('public/demo/reading-chair.jpg'),
  hash = crypto.createHash('sha256').update(input).digest('hex')
class ApiError extends Error {
  constructor(m, status) {
    super(m)
    this.status = status
  }
}
function harness() {
  const objects = new Map(),
    verified = new Set(),
    calls = [],
    batch = {
      id: 'batch',
      state: 'preparing',
      assets: [1, 2, 3].map((n) => ({
        id: String(n),
        source_path: 'source/' + n,
        path: 'batch/' + n,
      })),
    }
  let failUpload = '',
    corrupt = '',
    failDelete = false
  const backend = {
    rpc: async (n, p) => {
      calls.push([n, p])
      if (n === 'marketplace_prepare_order_media')
        return { data: structuredClone(batch) }
      if (n === 'marketplace_verify_order_media') {
        assert.equal(p.p_sha, hash)
        assert.equal(p.p_size, input.length)
        verified.add(p.p_asset)
        if (verified.size === 3) batch.state = 'prepared'
        return { data: structuredClone(batch) }
      }
      if (n === 'marketplace_claim_order_media_cleanup') {
        batch.state = 'delete_claimed'
        return { data: { batch_id: 'batch', lease: 'lease' } }
      }
      if (n === 'marketplace_order_media_delete_lease')
        return { data: structuredClone(batch) }
      if (n === 'marketplace_finish_order_media_cleanup') {
        batch.state = 'deleted'
        return { data: null }
      }
      throw Error(n)
    },
    storage: {
      from: (b) => ({
        info: async (p) =>
          objects.has(p) ? { data: {} } : { error: { statusCode: 404 } },
        upload: async (p, bytes, o) => {
          assert.equal(o.upsert, false)
          if (p === failUpload) return { error: { statusCode: 503 } }
          assert(!objects.has(p))
          objects.set(p, Buffer.from(bytes))
          return { data: { path: p } }
        },
        download: async (p) => {
          const body = b === 'listing-images' ? input : objects.get(p)
          return body
            ? {
                data: new Blob(
                  [p === corrupt ? Buffer.from('corrupt') : body],
                  { type: 'image/jpeg' }
                ),
              }
            : { error: {} }
        },
        remove: async (paths) => {
          if (failDelete) return { error: {} }
          paths.forEach((p) => objects.delete(p))
          return { data: [] }
        },
      }),
    },
  }
  const exports = {}
  const deps = {
    crypto: crypto,
    '@/lib/listing-images': {
      hasImageSignature: () => true,
      listingImageRules: { maxBytes: 3145728 },
    },
    '@/lib/listing-validation': { ListingApiError: ApiError },
    '@/lib/server/chat-image-storage': { createChatStorage: () => backend },
    '@/lib/server/marketplace-auth': {
      requireMarketplaceUser: async () => ({ id: 'actor' }),
    },
    '@/lib/server/messages-environment': { messageUuid: (v) => v },
  }
  vm.runInNewContext(code, {
    exports,
    require: (n) => {
      assert(deps[n], n)
      return deps[n]
    },
    process: {
      env: {
        APP_ENV: 'staging',
        NEXT_PUBLIC_SUPABASE_URL: 'https://pcaqxezdfxofysghssyo.supabase.co',
      },
    },
    Buffer,
    Blob,
    Date,
  })
  return {
    service: exports,
    objects,
    batch,
    calls,
    setFail: (p) => (failUpload = p),
    setCorrupt: (p) => (corrupt = p),
    setDeleteFailure: () => (failDelete = true),
  }
}
;(async () => {
  let h = harness()
  h.setFail('batch/2')
  await assert.rejects(
    h.service.prepareOrderSnapshotMedia({}, 'offer', 'command')
  )
  assert.equal(h.batch.state, 'preparing')
  assert.equal(h.objects.size, 1)
  assert.equal(
    h.calls.filter((c) => c[0] === 'marketplace_verify_order_media').length,
    1
  )
  h.setFail('')
  assert.equal(
    (await h.service.prepareOrderSnapshotMedia({}, 'offer', 'command')).state,
    'prepared'
  )
  assert.equal(h.objects.size, 3)
  await h.service.prepareOrderSnapshotMedia({}, 'offer', 'command')
  assert.equal(h.objects.size, 3)
  h = harness()
  h.setCorrupt('batch/1')
  await assert.rejects(
    h.service.prepareOrderSnapshotMedia({}, 'offer', 'command')
  )
  assert.equal(
    h.calls.filter((c) => c[0] === 'marketplace_verify_order_media').length,
    0
  )
  h = harness()
  await h.service.prepareOrderSnapshotMedia({}, 'offer', 'command')
  h.setDeleteFailure()
  await assert.rejects(h.service.cleanupOrderSnapshotMedia('batch'))
  assert.equal(h.batch.state, 'delete_claimed')
  assert(
    !h.calls.some((c) => c[0] === 'marketplace_finish_order_media_cleanup')
  )
  console.log(
    'C1 static/transport regressions PASS: partial failure, SHA mismatch, idempotent upload, failed deletion tracking; no transaction mutation'
  )
})().catch((e) => {
  console.error(e.message)
  process.exitCode = 1
})
