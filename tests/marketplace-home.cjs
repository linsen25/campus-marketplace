const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

let result = []
let fail = false
let receivedQuery
const element =
  (tag) =>
  ({ children, ...props }) =>
    React.createElement(tag, props, children)
const mocks = {
  '@/components/listings/listing-filters': {
    ListingFilters: () =>
      React.createElement('div', { 'data-testid': 'browse-controls' }),
  },
  'next/head': { default: ({ children }) => children, __esModule: true },
  '@/components/container/container': { Container: element('div') },
  '@/components/listings/listing-grid': {
    ListingGrid: ({ listings }) =>
      React.createElement(
        'div',
        null,
        listings.map((item) => item.title).join(', ')
      ),
  },
  '@ui/input/input': { Input: element('input') },
  '@ui/link/link': { Link: element('a') },
  '@/lib/listings-api': {
    getListings: async (query, context) => {
      receivedQuery = query
      assert(context.req && context.res)
      if (fail) throw new Error('Private backend detail')
      return result
    },
  },
}
function load(file) {
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (name) =>
      mocks[name] ||
      (name.startsWith('@/') ? load(name.slice(2) + '.ts') : require(name)),
    module,
    module.exports
  )
  return module.exports
}
async function main() {
  const home = load('pages/index.tsx')
  const headers = {}
  const context = {
    req: {},
    res: {
      setHeader: (name, value) => {
        headers[name] = value
      },
    },
  }
  const empty = await home.getServerSideProps(context)
  assert.deepEqual(receivedQuery, {
    search: '',
    category: undefined,
    condition: undefined,
    minPrice: undefined,
    maxPrice: undefined,
    status: 'available',
    sort: 'newest',
    page: 1,
    pageSize: 10,
  })
  assert.match(headers['Cache-Control'], /no-store/)
  const html = renderToStaticMarkup(
    React.createElement(home.default, empty.props)
  )
  assert.match(html, /No listings match/)
  assert(!html.includes('Marketplace categories'))
  await home.getServerSideProps({
    ...context,
    query: {
      category: 'Electronics',
      condition: 'good',
      minPrice: '20',
      maxPrice: '100',
      status: 'sold',
      search: 'monitor',
      sort: 'price-low',
    },
  })
  assert.equal(receivedQuery.category, 'electronics')
  assert.equal(receivedQuery.condition, 'good')
  assert.equal(receivedQuery.minPrice, 2000)
  assert.equal(receivedQuery.maxPrice, 10000)
  assert.equal(receivedQuery.status, 'sold')
  assert.equal(receivedQuery.search, 'monitor')
  assert.equal(receivedQuery.sort, 'price-low')
  result = [{ title: 'Test desk' }]
  const populated = await home.getServerSideProps(context)
  assert.match(
    renderToStaticMarkup(React.createElement(home.default, populated.props)),
    /Test desk/
  )
  fail = true
  const unavailable = await home.getServerSideProps(context)
  assert.equal(context.res.statusCode, 503)
  const errorHtml = renderToStaticMarkup(
    React.createElement(home.default, unavailable.props)
  )
  assert.match(errorHtml, /role="alert"/)
  assert(!errorHtml.includes('Private backend detail'))
  assert(!errorHtml.includes('No listings match'))
  console.log(
    'PASS: homepage available/newest query, no-store, shared filter/search query, populated/empty/error states (data boundary mocked).'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
