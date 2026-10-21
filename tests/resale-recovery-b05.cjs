// B05 regression: actual publication orchestrator, no network or database.
// Keeps the server draft ID in the open form; no cross-close persistence.
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path'),
  ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full)
  const m = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: { module: 1, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) =>
      name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name),
    m,
    m.exports
  )
  cache.set(full, m.exports)
  return m.exports
}
async function main() {
  global.fetch = async () => {
    throw Error('Network forbidden')
  }
  const { createPublishedListing } = load('lib/listing-publication.ts')
  const drafts = new Map()
  let created = 0
  const operations = {
    createListing: async (input) => {
      const row = {
        id: 'b05-local-draft-' + ++created,
        publishedAt: null,
        expectedImageCount: input.expectedImageCount,
      }
      drafts.set(row.id, row)
      return row
    },
    uploadListingImage: async () => {
      throw Error('Controlled upload failure')
    },
    getCreationListing: async (id) => drafts.get(id),
    abandonListing: async () => {
      throw Error('Controlled cleanup failure before deletion')
    },
    finalizeListing: async () => {
      throw Error('Incomplete image manifest')
    },
  }
  const input = {
    title: 'B05 local item',
    description: '',
    price: 100,
    currency: 'CAD',
    category: 'Other',
    subcategory: 'Other',
    pickupArea: 'On campus',
    meetingLocation: { label: 'Outside library' },
    photoUrls: [],
  }
  const files = [{ type: 'image/png', size: 100 }]
  const submit = () =>
    createPublishedListing(input, files, operations).catch(() => ({
      state: 'rejected-without-listing-id',
    }))
  const first = await submit()
  // Mirrors the existing form: only a returned PublicationResult sets pending.
  if (first.state === 'rejected-without-listing-id') await submit()
  console.log(
    JSON.stringify({
      firstResult: first.state,
      returnedListingId: Boolean(first.listingId),
      remainingDrafts: drafts.size,
      networkCalls: 0,
    })
  )
  assert.equal(
    first.state,
    'unpublished',
    'B05: confirmed remaining unpublished draft must retain its ID after cleanup failure'
  )
  assert.equal(
    drafts.size,
    1,
    'B05: retry must not leave a second unmanaged draft'
  )
  console.log(
    'PASS B05 lost-draft regression: same ID retained, no duplicate draft'
  )
}
main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
