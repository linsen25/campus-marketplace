const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
const calls = []
const uid = '11111111-1111-4111-8111-111111111111'
const seller = '22222222-2222-4222-8222-222222222222'
const ids = Array.from(
  { length: 5 },
  (_, i) => `33333333-3333-4333-8333-${String(i + 1).padStart(12, '0')}`
)
const rows = ids.map((id, i) => ({
  id,
  seller_id: i === 4 ? uid : seller,
  title: 'Camera',
  description: '',
  price_cents: 100 * (i + 1),
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickup_area: 'Near campus',
  status: i === 2 ? 'sold' : 'available',
  published_at: i === 3 ? null : '2026-10-05',
  expected_image_count: 0,
  created_at: `2026-10-0${i + 1}`,
  updated_at: '2026-10-05',
  profiles: { id: i === 4 ? uid : seller, display_name: 'Seller' },
  listing_images: [],
}))
const favorites = new Set([ids[0], ids[2], ids[3]])
let authorized = true,
  csrf = true
function builder(table) {
  const filters = [],
    orders = []
  let selection = '',
    operation = 'select',
    payload,
    bounds
  const chain = {
    select(value) {
      selection = value
      calls.push(['select', table, value])
      return chain
    },
    eq(key, value) {
      filters.push([key, value])
      calls.push(['eq', table, key, value])
      return chain
    },
    filter(key, op, value) {
      assert.equal(op, 'not.is')
      assert.equal(value, 'null')
      filters.push([key, 'NOT_NULL'])
      return chain
    },
    is(key, value) {
      filters.push([key, value])
      return chain
    },
    order(key, options = {}) {
      orders.push([key, options.ascending !== false])
      return chain
    },
    range(a, b) {
      bounds = [a, b]
      return chain
    },
    insert(value) {
      operation = 'insert'
      payload = value
      return chain
    },
    update(value) {
      operation = 'update'
      payload = value
      return chain
    },
    delete() {
      operation = 'delete'
      return chain
    },
    then(resolve, reject) {
      return Promise.resolve(execute()).then(resolve, reject)
    },
    maybeSingle() {
      const result = execute()
      return Promise.resolve({ ...result, data: result.data?.[0] || null })
    },
    single() {
      return chain.maybeSingle()
    },
  }
  function execute() {
    let result =
      table === 'listings'
        ? rows.slice()
        : [...favorites].map((listing_id) => ({ user_id: uid, listing_id }))
    result = result.filter((row) =>
      filters.every(([key, value]) =>
        key === 'listing_favorites.user_id'
          ? favorites.has(row.id) && value === uid
          : value === 'NOT_NULL'
          ? row[key] != null
          : row[key] === value
      )
    )
    if (operation === 'insert' && table === 'listing_favorites') {
      assert.equal(payload.user_id, uid)
      if (favorites.has(payload.listing_id))
        return { data: null, error: { code: '23505' } }
      favorites.add(payload.listing_id)
      return { data: [], error: null }
    }
    if (operation === 'delete') {
      if (table === 'listing_favorites')
        result.forEach((row) => favorites.delete(row.listing_id))
      else result.forEach((row) => rows.splice(rows.indexOf(row), 1))
    }
    if (operation === 'update')
      result.forEach((row) => Object.assign(row, payload))
    if (operation === 'insert' && table === 'listings') {
      const row = { ...rows[0], ...payload, id: ids[3], published_at: null }
      result = [row]
    }
    if (selection.includes('listing_favorites!inner'))
      result = result.filter((row) => favorites.has(row.id))
    for (let i = orders.length - 1; i >= 0; i--) {
      const [key, ascending] = orders[i]
      result.sort(
        (a, b) =>
          (a[key] < b[key] ? -1 : a[key] > b[key] ? 1 : 0) *
          (ascending ? 1 : -1)
      )
    }
    if (bounds) result = result.slice(bounds[0], bounds[1] + 1)
    return { data: result, error: null }
  }
  return chain
}
const client = {
  from: builder,
  storage: {
    from: () => ({
      getPublicUrl: (p) => ({ data: { publicUrl: p } }),
      remove: async () => ({ error: null }),
    }),
  },
  rpc: async (name, args) => {
    assert.equal(name, 'marketplace_finalize_listing')
    const row = rows.find((r) => r.id === args.listing_id)
    row.published_at = '2026-10-05'
    return { data: row.id, error: null }
  },
}
const mocks = {
  '@/lib/supabase/server': { createMarketplaceClient: () => client },
  '@/lib/server/marketplace-auth': {
    requireMarketplaceUser: async () => {
      if (!authorized)
        throw new (load('lib/listing-validation.ts').ListingApiError)(
          'Login required',
          401
        )
      return { id: uid }
    },
    requireSameOriginWrite: () => {
      if (!csrf)
        throw new (load('lib/listing-validation.ts').ListingApiError)(
          'Invalid origin',
          403
        )
    },
  },
}
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      mocks[name] ||
      (name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)),
    module,
    module.exports
  )
  cache.set(full, module.exports)
  return module.exports
}
const response = () => ({
  setHeader() {},
  status(code) {
    this.code = code
    return this
  },
  json(body) {
    this.body = body
    return this
  },
})
async function main() {
  const repository = load(
    'lib/server/supabase-listings-repository.ts'
  ).createSupabaseListingsRepository({})
  assert.equal(await repository.getListing(ids[3]), null)
  assert.equal((await repository.getListings()).length, 3)
  assert.equal((await repository.getMyListings()).length, 1)
  const created = await repository.createListing({
    title: 'Camera',
    description: '',
    price: 0,
    currency: 'CAD',
    category: 'Electronics',
    subcategory: 'Cameras',
    pickupArea: 'Near campus',
    photoUrls: [],
    expectedImageCount: 2,
  })
  assert.equal(created.expectedImageCount, 2)
  assert.equal(created.publishedAt, null)
  rows[2].seller_id = uid
  rows[2].profiles.id = uid
  await assert.rejects(
    repository.updateListing(ids[2], { title: 'sold edit' }),
    /Only published available/
  )
  rows[2].seller_id = seller
  rows[2].profiles.id = seller
  await assert.rejects(repository.setFavorite(ids[4], true), /another seller/)
  await assert.rejects(
    repository.setFavorite(ids[3], true),
    /published available/
  )
  await assert.rejects(
    repository.setFavorite(ids[2], true),
    /published available/
  )
  await repository.setFavorite(ids[0], true) // Idempotent duplicate.
  await repository.setFavorite(ids[1], true)
  const favoritesHandler = load(
    'pages/api/favorites/[[...segments]].ts'
  ).default
  let res = response()
  await favoritesHandler(
    {
      method: 'GET',
      query: {
        category: 'Electronics',
        subcategory: 'Cameras',
        condition: 'good',
        place: 'Near campus',
        sort: 'price-desc',
      },
    },
    res
  )
  assert.equal(res.code, 200)
  assert.deepEqual(
    res.body.map((r) => r.id),
    [ids[1], ids[0]]
  )
  assert(
    calls.some(
      (c) =>
        c[0] === 'eq' && c[2] === 'listing_favorites.user_id' && c[3] === uid
    )
  )
  res = response()
  await favoritesHandler(
    { method: 'GET', query: { sort: 'price-asc', page: '1', pageSize: '1' } },
    res
  )
  assert.deepEqual(
    res.body.map((r) => r.id),
    [ids[0]]
  )
  res = response()
  await favoritesHandler(
    { method: 'GET', query: { subcategory: 'Cameras' } },
    res
  )
  assert.equal(res.code, 400)
  res = response()
  await favoritesHandler({ method: 'GET', query: { segments: [ids[1]] } }, res)
  assert.deepEqual(res.body, { favorited: true })
  res = response()
  await favoritesHandler(
    { method: 'DELETE', query: { segments: [ids[1]] } },
    res
  )
  assert.deepEqual(res.body, { favorited: false })
  authorized = false
  res = response()
  await favoritesHandler({ method: 'GET', query: {} }, res)
  assert.equal(res.code, 401)
  authorized = true
  csrf = false
  res = response()
  await favoritesHandler({ method: 'POST', query: { segments: [ids[0]] } }, res)
  assert.equal(res.code, 403)
  csrf = true
  res = response()
  await favoritesHandler(
    { method: 'PATCH', query: { segments: [ids[0]] } },
    res
  )
  assert.equal(res.code, 405)
  // Published cleanup predicate prevents deleting an already-published listing.
  await assert.rejects(repository.abandonListing(ids[4]), /already published/)
  assert(rows.some((r) => r.id === ids[4]))
  const imageHandler = load('pages/api/listing-images/[id].ts').default
  res = response()
  await imageHandler(
    { method: 'DELETE', headers: {}, query: { id: ids[4] } },
    res
  )
  assert.equal(res.code, 400)
  assert.match(res.body.error, /immutable/)
  // Owner reconciliation is a private GET path, including unpublished state.
  const listingsHandler = load('pages/api/listings/[[...segments]].ts').default
  rows[3].seller_id = uid
  rows[3].profiles.id = uid
  res = response()
  await listingsHandler(
    { method: 'GET', query: { segments: [ids[3], 'creation'] } },
    res
  )
  assert.equal(res.code, 200)
  assert.equal(res.body.id, ids[3])
  assert.equal(res.body.publishedAt, null)
  res = response()
  await listingsHandler({ method: 'GET', query: { segments: [ids[3]] } }, res)
  assert.equal(res.body, null)
  authorized = false
  res = response()
  await listingsHandler(
    { method: 'GET', query: { segments: [ids[3], 'creation'] } },
    res
  )
  assert.equal(res.code, 401)
  authorized = true
  rows[3].seller_id = seller
  rows[3].profiles.id = seller
  res = response()
  await listingsHandler(
    { method: 'GET', query: { segments: [ids[3], 'creation'] } },
    res
  )
  assert.equal(res.code, 403)
  res = response()
  await listingsHandler(
    { method: 'POST', query: { segments: [ids[3], 'creation'] } },
    res
  )
  assert.equal(res.code, 405)
  const {
    createPublishedListing,
    continueListingPublication,
    reconcileListingPublication,
  } = load('lib/listing-publication.ts')
  const { validateListingInput } = load('lib/listing-validation.ts')
  const input = {
    title: 'Item',
    description: '',
    price: 10,
    currency: 'CAD',
    category: 'Other',
    subcategory: 'Other',
    pickupArea: 'On campus',
    photoUrls: [],
  }
  for (const count of [0, 7, -1, undefined])
    assert.throws(
      () => validateListingInput({ ...input, expectedImageCount: count }),
      /between 1 and 6/
    )
  for (const count of [1, 6])
    assert.equal(
      validateListingInput({ ...input, expectedImageCount: count })
        .expectedImageCount,
      count
    )
  const files = [
    { type: 'image/png', size: 100 },
    { type: 'image/jpeg', size: 100 },
  ]
  const sequence = []
  let failUpload = false,
    failFinalize = 0,
    failCleanup = false,
    unknown = false,
    commitOnLostResponse = false,
    serverListing
  const ops = {
    createListing: async (value) => {
      sequence.push(['create', value.expectedImageCount])
      serverListing = { id: ids[3], publishedAt: null }
      return serverListing
    },
    uploadListingImage: async () => {
      sequence.push(['upload'])
      if (failUpload) throw new Error('upload failure')
    },
    finalizeListing: async (id) => {
      assert.equal(id, ids[3])
      sequence.push(['finalize', id])
      if (failFinalize-- > 0) {
        if (commitOnLostResponse)
          serverListing = { ...serverListing, publishedAt: 'now' }
        throw new Error('lost response')
      }
      serverListing = { ...serverListing, publishedAt: 'now' }
      return serverListing
    },
    getCreationListing: async (id) => {
      sequence.push(['reconcile', id])
      assert.equal(id, ids[3])
      if (unknown) throw new Error('network unavailable')
      return serverListing
    },
    abandonListing: async (id) => {
      sequence.push(['abandon', id])
      assert.equal(serverListing.publishedAt, null)
      if (failCleanup) throw new Error('cleanup failure')
    },
  }
  assert.equal(
    (await createPublishedListing(input, files, ops)).state,
    'published'
  )
  assert.deepEqual(
    sequence.map((s) => s[0]),
    ['create', 'upload', 'upload', 'finalize']
  )
  sequence.length = 0
  failUpload = true
  failCleanup = true
  await assert.rejects(
    createPublishedListing(input, files, ops),
    /upload failure/
  )
  assert.deepEqual(
    sequence.map((s) => s[0]),
    ['create', 'upload', 'reconcile', 'abandon']
  )
  assert.equal(files.length, 2)
  assert.equal(input.title, 'Item')
  assert.deepEqual(input.photoUrls, [])
  sequence.length = 0
  failUpload = false
  failFinalize = 1
  assert.equal(
    (await createPublishedListing(input, files, ops)).state,
    'published'
  )
  assert.deepEqual(
    sequence.map((s) => s[0]),
    ['create', 'upload', 'upload', 'finalize', 'finalize']
  )
  // BOTH successful publication responses can be lost: owner reconciliation proves success.
  sequence.length = 0
  failFinalize = 2
  commitOnLostResponse = true
  const recovered = await createPublishedListing(input, files, ops)
  assert.equal(recovered.state, 'published')
  assert.equal(recovered.listingId, ids[3])
  assert.deepEqual(
    sequence.map((s) => s[0]),
    ['create', 'upload', 'upload', 'finalize', 'finalize', 'reconcile']
  )
  // Confirmed unpublished state preserves ID; retry never creates another row or abandons it.
  sequence.length = 0
  failFinalize = 2
  commitOnLostResponse = false
  const pending = await createPublishedListing(input, files, ops)
  assert.equal(pending.state, 'unpublished')
  assert.equal(pending.listingId, ids[3])
  assert(pending.retryable)
  sequence.length = 0
  assert.equal(
    (await continueListingPublication(pending.listingId, ops)).state,
    'published'
  )
  assert.deepEqual(
    sequence.map((s) => s[0]),
    ['finalize']
  )
  // Unknown state preserves ID/form/files and never deletes or creates during continuation.
  sequence.length = 0
  failFinalize = 2
  unknown = true
  const uncertain = await createPublishedListing(input, files, ops)
  assert.equal(uncertain.state, 'unknown')
  assert.equal(uncertain.listingId, ids[3])
  assert(uncertain.retryable)
  assert(!sequence.some((s) => s[0] === 'abandon'))
  assert.equal(sequence.filter((s) => s[0] === 'create').length, 1)
  sequence.length = 0
  failFinalize = 2
  assert.equal(
    (await continueListingPublication(uncertain.listingId, ops)).state,
    'unknown'
  )
  assert(
    !sequence.some(
      (s) => s[0] === 'create' || s[0] === 'abandon' || s[0] === 'upload'
    )
  )
  unknown = false
  serverListing = { id: ids[3], publishedAt: 'now' }
  assert.equal(
    (await reconcileListingPublication(uncertain.listingId, ops)).state,
    'published'
  )
  sequence.length = 0
  await assert.rejects(
    createPublishedListing(input, [], ops),
    /between 1 and 6/
  )
  await assert.rejects(
    createPublishedListing(input, Array(7).fill(files[0]), ops),
    /between 1 and 6/
  )
  await assert.rejects(
    createPublishedListing(input, [{ type: 'text/plain', size: 100 }], ops)
  )
  assert.equal(sequence.length, 0)
  for (const count of [1, 6]) {
    sequence.length = 0
    failFinalize = 0
    assert.equal(
      (await createPublishedListing(input, Array(count).fill(files[0]), ops))
        .state,
      'published'
    )
    assert.deepEqual(sequence[0], ['create', count])
    assert.equal(sequence.filter((s) => s[0] === 'upload').length, count)
  }
  // Exercise the actual metadata-first cleanup helper using only provider boundaries.
  const { removeImageReservation } = load('pages/api/listing-images/[id].ts')
  const cleanup = []
  let metadataError = null,
    storageError = null
  const cleanupClient = {
    from: (table) => {
      assert.equal(table, 'listing_images')
      const chain = {
        delete() {
          cleanup.push('metadata')
          return chain
        },
        eq() {
          return chain
        },
        select() {
          return chain
        },
        maybeSingle: async () => ({
          data: metadataError ? null : { id: 'image' },
          error: metadataError,
        }),
      }
      return chain
    },
    storage: {
      from: (bucket) => {
        assert.equal(bucket, 'listing-images')
        return {
          remove: async () => {
            cleanup.push('Storage API')
            return { error: storageError }
          },
        }
      },
    },
  }
  await removeImageReservation(cleanupClient, {
    id: 'image',
    path: 'owner/listing/image',
  })
  assert.deepEqual(cleanup, ['metadata', 'Storage API'])
  cleanup.length = 0
  metadataError = { code: '23514' }
  await assert.rejects(
    removeImageReservation(cleanupClient, {
      id: 'image',
      path: 'owner/listing/image',
    })
  )
  assert.deepEqual(cleanup, ['metadata'])
  cleanup.length = 0
  metadataError = null
  storageError = { message: 'unavailable' }
  await assert.rejects(
    removeImageReservation(cleanupClient, {
      id: 'image',
      path: 'owner/listing/image',
    }),
    /orphan object/
  )
  assert.deepEqual(cleanup, ['metadata', 'Storage API'])
  const apiSource = fs.readFileSync('pages/api/listing-images/[id].ts', 'utf8')
  assert(!apiSource.includes("from('objects')"))
  assert(!apiSource.includes('storage.objects'))
  const migration = fs.readFileSync(
    'supabase/migrations/202610050001_marketplace_publication_favorites.sql',
    'utf8'
  )
  assert(!/create trigger[^;]*on storage\.objects/.test(migration))
  assert(!migration.includes('protect_published_listing_storage'))
  console.log(
    'PASS API/domain: Favorites regressions; 1-6 manifest; metadata-first Storage API cleanup; both finalize responses lost reconcile success; unpublished/unknown same-ID continuation; published abandon protection; form/files preserved.'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
