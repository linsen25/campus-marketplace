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
    status: 'available',
    sort: 'newest',
    page: 1,
    pageSize: 10,
  })
  assert.match(headers['Cache-Control'], /no-store/)
  const html = renderToStaticMarkup(
    React.createElement(home.default, empty.props)
  )
  assert.match(html, /No items available yet/)
  assert.match(html, /action="\/listings"/)
  assert.match(html, /name="search"/)
  const { listingCategories } = load('lib/listing-metadata.ts')
  for (const category of listingCategories)
    assert(
      html.includes('/listings?category=' + encodeURIComponent(category.label))
    )
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
  assert(!errorHtml.includes('No items available yet'))
  console.log(
    'PASS: homepage available/newest query, no-store, category/search links, populated/empty/error states (data boundary mocked).'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
