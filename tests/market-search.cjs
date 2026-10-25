const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const cache = new Map()
function load(file) {
  const full = path.resolve(file)
  if (cache.has(full)) return cache.get(full).exports
  const module = { exports: {} }
  cache.set(full, module)
  const code = ts.transpileModule(fs.readFileSync(full, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (name.startsWith('@/')) return load(name.slice(2) + '.ts')
      if (name.startsWith('.'))
        return load(path.resolve(path.dirname(full), name) + '.ts')
      return require(name)
    },
    module,
    module.exports
  )
  return module.exports
}
const { normalizeSearchQuery, searchListings, searchSuggestions } = load(
  'lib/market-search.ts'
)
const { marketPreviewListings } = load('lib/fixtures/market-layout.ts')
assert.equal(normalizeSearchQuery('  GAMING   monitor  '), 'gaming monitor')
const make = (
  id,
  title,
  subcategory = '',
  category = '',
  description = ''
) => ({ id, title, subcategory, category, description })
const samples = [
  make('desc', 'Desk', '', '', 'Works with a monitor'),
  make('cat', 'Cable', '', 'Monitor accessories'),
  make('sub', 'Adapter', 'Monitors'),
  make('phrase', 'Dell gaming monitor'),
  make('prefix', 'Monitor stand'),
  make('exact', 'Monitor'),
]
assert.deepEqual(
  searchListings(samples, 'MONITOR').map((x) => x.id),
  ['exact', 'phrase', 'prefix', 'sub', 'cat', 'desc']
)
assert.equal(
  searchListings(samples, 'onitor').length,
  0,
  'No buried substrings'
)
assert.equal(searchListings(samples, 'gaming monitor')[0].id, 'phrase')
for (const [query, title] of [
  ['mon', '24-inch monitor'],
  ['calc', 'Scientific calculator'],
  ['head', 'Wireless headphones'],
])
  assert(
    searchListings(marketPreviewListings, query).some((x) => x.title === title)
  )
assert.deepEqual(searchSuggestions(marketPreviewListings, ''), [])
assert.equal(
  searchSuggestions(marketPreviewListings, 'zzzz-no-match').length,
  1
)
const suggestions = searchSuggestions(marketPreviewListings, 'mon')
assert.equal(suggestions[0].kind, 'search')
assert.equal(suggestions[1].label, '24-inch monitor')
assert(
  suggestions.some((x) => x.kind === 'category' && x.subcategory === 'Monitors')
)
for (const query of ['market', 'electronics', 'mon', 'calc', '  '])
  assert(searchSuggestions(marketPreviewListings, query).length <= 5)
assert.deepEqual(
  searchListings(samples, 'monitor').map((x) => x.id),
  searchListings(samples, 'monitor').map((x) => x.id)
)
assert.equal(
  searchListings(marketPreviewListings, 'CampusChris').length,
  0,
  'Seller is not searchable'
)
assert.equal(marketPreviewListings.length, 30)
console.log(
  'PASS: normalization, field relevance, stable ties, useful prefixes, no buried matches, ranked suggestions, 5-row limit, unchanged fixture data'
)
