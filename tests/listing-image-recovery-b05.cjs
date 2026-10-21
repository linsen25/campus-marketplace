/* global Blob */
// Actual recovery service; deterministic Storage/DB faults and races, no network.
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript'),
  assert = require('node:assert/strict')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (n) => (n.startsWith('@/') ? load(n.slice(2) + '.ts') : require(n)),
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
const { recoverListingImage } = load('lib/server/listing-image-recovery.ts')
const owner = '11111111-1111-4111-8111-111111111111',
  id = '22222222-2222-4222-8222-222222222222'
const rows = new Map(),
  objects = new Map()
let sequence = 0,
  uploads = 0,
  mode = ''
const client = {
  from() {
    let op = 'read',
      input,
      filters = []
    const q = {
      select() {
        return q
      },
      eq(k, v) {
        filters.push([k, v])
        return q
      },
      insert(v) {
        op = 'insert'
        input = v
        return q
      },
      update(v) {
        op = 'update'
        input = v
        return q
      },
      maybeSingle: async () => run(),
      then(resolve, reject) {
        return Promise.resolve(run()).then(resolve, reject)
      },
    }
    function run() {
      if (op === 'insert') {
        if (rows.has(input.slot)) return { error: { code: '23505' } }
        const imageId = String(++sequence),
          row = {
            id: imageId,
            owner_id: owner,
            listing_id: id,
            slot: input.slot,
            ready: false,
            storage_bucket: 'listing-images-private',
            path: `${owner}/${id}/${imageId}`,
          }
        rows.set(row.slot, row)
        return { error: null }
      }
      const row = [...rows.values()].find((r) =>
        filters.every(([k, v]) => r[k] === v)
      )
      if (op === 'update' && row) {
        if (mode === 'removed') return { data: null, error: null }
        Object.assign(row, input)
      }
      return { data: row ? { ...row } : null, error: null }
    }
    return q
  },
  storage: {
    from(source) {
      assert.equal(source, 'listing-images-private')
      return {
        remove: async (paths) => {
          if (mode === 'late-cleanup-failure')
            return { error: { message: 'controlled cleanup failure' } }
          for (const p of paths) {
            assert(
              ![...rows.values()].some((r) => r.path === p),
              'never delete referenced object'
            )
            objects.delete(p)
          }
          return { error: null }
        },
        download: async (p) => {
          if (mode === 'download-failure')
            return { data: null, error: { status: 500 } }
          return objects.has(p)
            ? { data: new Blob([objects.get(p)]), error: null }
            : { data: null, error: { status: 404, statusCode: '404' } }
        },
        upload: async (p, b, options) => {
          assert.equal(options.upsert, false)
          uploads++
          if (objects.has(p)) return { error: { status: 409 } }
          if (mode === 'upload-failure') return { error: { status: 503 } }
          objects.set(p, Buffer.from(b))
          if (['late-upload', 'late-cleanup-failure'].includes(mode)) {
            const item = [...rows.values()].find((r) => r.path === p)
            rows.delete(item.slot)
          }
          if (mode === 'lost-upload') return { error: { status: 503 } }
          return { error: null }
        },
      }
    },
  },
}
const photo = Buffer.from('original bytes'),
  other = Buffer.from('different bytes')
const run = (slot = 1, bytes = photo, user = owner) =>
  recoverListingImage(client, id, user, {
    slot,
    bytes,
    contentType: 'image/png',
  })
async function main() {
  await Promise.all([run(), run()])
  assert.equal(rows.size, 1)
  assert.equal(objects.size, 1)
  assert(rows.get(1).ready)
  const writes = uploads
  await run()
  assert.equal(uploads, writes, 'ready retry must not upload')
  await assert.rejects(run(1, other), /does not match/)
  assert(objects.get(rows.get(1).path).equals(photo))
  await assert.rejects(run(1, photo, 'outsider'), /reservation/)
  mode = 'download-failure'
  await assert.rejects(run(), /confirm stored/)
  assert.equal(uploads, writes, 'unknown storage is not absence')
  mode = 'upload-failure'
  await assert.rejects(run(2), /unconfirmed/)
  assert(!rows.get(2).ready)
  assert.equal(rows.size, 2)
  mode = ''
  await run(2)
  assert(rows.get(2).ready)
  mode = 'lost-upload'
  await assert.rejects(run(3), /unconfirmed/)
  const afterLost = uploads
  mode = ''
  await run(3)
  assert.equal(
    uploads,
    afterLost,
    'stored bytes reconcile lost response without second upload'
  )
  assert(rows.get(3).ready)
  objects.delete(rows.get(3).path)
  await assert.rejects(run(3), /ready image is missing/)
  mode = 'removed'
  await assert.rejects(run(4), /removed/)
  mode = ''
  await run(4)
  assert.equal(rows.size, 4)
  const beforeLate = objects.size
  mode = 'late-upload'
  await assert.rejects(run(5), /reservation changed/)
  assert.equal(rows.size, 4)
  assert.equal(objects.size, beforeLate, 'late upload after Discard cleaned')
  mode = 'late-cleanup-failure'
  const logs = [],
    savedWarn = console.warn
  console.warn = (...args) => logs.push(args)
  try {
    await assert.rejects(run(6), /reservation changed/)
  } finally {
    console.warn = savedWarn
  }
  assert.equal(rows.size, 4)
  assert.equal(
    objects.size,
    beforeLate + 1,
    'failed cleanup preserves tracked private orphan'
  )
  assert(logs.some((args) => args[0].includes('cleanup requires retry')))
  mode = ''

  rows.clear()
  objects.clear()
  uploads = 0
  let creates = 0,
    finalizes = 0,
    loseSecond = true,
    unknown = false
  let listing
  const files = ['first', 'second'].map((label) => ({
    label,
    type: 'image/png',
    size: 10,
  }))
  const operations = {
    createListing: async (input) => {
      creates++
      listing = {
        id,
        publishedAt: null,
        expectedImageCount: input.expectedImageCount,
      }
      return listing
    },
    getCreationListing: async () => {
      if (unknown) throw Error('offline')
      return listing
    },
    uploadListingImage: async (target, file, slot) => {
      assert.equal(target, id)
      mode = slot === 2 && loseSecond ? 'lost-upload' : ''
      if (slot === 2) loseSecond = false
      await run(slot, Buffer.from(file.label))
    },
    finalizeListing: async () => {
      assert.equal(rows.size, 2)
      assert([...rows.values()].every((row) => row.ready))
      finalizes++
      listing = { ...listing, publishedAt: '2026-10-19' }
      return listing
    },
    abandonListing: async () => {
      throw Error('Unexpected automatic abandon')
    },
  }
  const { createPublishedListing, continueListingPublication } = load(
    'lib/listing-publication.ts'
  )
  const input = {
    title: 'Recovery',
    price: 100,
    currency: 'CAD',
    category: 'Other',
    subcategory: 'Other',
    description: '',
    pickupArea: 'Campus',
    meetingLocation: { label: 'Library' },
    photoUrls: [],
  }
  const pending = await createPublishedListing(input, files, operations)
  assert.equal(pending.state, 'unpublished')
  assert.equal(pending.listingId, id)
  unknown = true
  assert.equal(
    (await continueListingPublication(id, operations, files)).state,
    'unknown'
  )
  assert.equal(uploads, 2)
  assert.equal(finalizes, 0)
  unknown = false
  assert.equal(
    (await continueListingPublication(id, operations, files)).state,
    'published'
  )
  assert.equal(uploads, 2, 'lost upload is reconciled without uploading again')
  assert.equal(creates, 1)
  assert.equal(finalizes, 1)
  await continueListingPublication(id, operations, files)
  assert.equal(uploads, 2)
  assert.equal(
    finalizes,
    1,
    'published authoritative state is returned without another finalize'
  )
  console.log(
    'PASS B05 slots: concurrent unique reservation, byte-identical retry, different bytes/owner denial, unknown storage fail-closed, upload failure/lost response recovery, missing ready object and removal race; zero network'
  )
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
