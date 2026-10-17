const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const source = fs.readFileSync('lib/server/orders-service.ts', 'utf8')
const m = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2021,
    },
  }).outputText
)(
  (name) =>
    name.endsWith('listing-validation')
      ? { ListingApiError: class extends Error {} }
      : name.endsWith('offers-service')
      ? { mapTerms: (v) => v }
      : name.endsWith('order-request-service')
      ? { mapRequest: () => ({ snapshot: {} }) }
      : {},
  m,
  m.exports
)
const row = {
  id: 'fixture',
  order_protocol_version: 2,
  terms_snapshot: { terms: {} },
  listing_snapshot: { title: 'Frozen', askingPriceCents: 10000 },
  item_amount_cents: 9000,
}
assert.deepEqual(m.exports.mapOrder(row).listingProvenance, {
  channel: 'resale',
})
row.listing_snapshot.listingChannel = 'resale'
assert.deepEqual(m.exports.mapOrder(row).listingProvenance, {
  channel: 'resale',
})
row.listing_snapshot = {
  ...row.listing_snapshot,
  listingChannel: 'shop',
  shopName: 'Vintage Loop',
}
assert.deepEqual(m.exports.mapOrder(row).listingProvenance, {
  channel: 'shop',
  shopName: 'Vintage Loop',
})
delete row.listing_snapshot.shopName
assert.throws(() => m.exports.mapOrder(row), /provenance unavailable/)
row.order_protocol_version = 1
assert.deepEqual(m.exports.mapOrder(row).listingProvenance, {
  channel: 'resale',
})
console.log(
  'PASS old/new Resale fallback, frozen Shop DTO, malformed Shop rejection, V1 compatibility'
)
