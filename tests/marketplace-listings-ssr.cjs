const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')

let failListings = false

const mocks = {
  '@/components/listings/market-layout': { MarketLayout: () => null },
  '@/lib/listing-filters': {
    parseListingFilters: () => ({
      values: { search: '' },
      query: {
        search: '',
        category: undefined,
        subcategory: undefined,
        condition: undefined,
        minPrice: undefined,
        maxPrice: undefined,
        sort: 'newest',
      },
      error: null,
    }),
  },
  '@/lib/listing-validation': {
    ListingApiError: class ListingApiError extends Error {},
  },
  '@/lib/listings-api': {
    getResaleListingsPage: async () => {
      if (failListings) throw new Error('backend unavailable')
      return { listings: [], total: 0 }
    },
  },
  '@/lib/server/public-shop': {
    getPublicShops: async () => ({ shops: [] }),
  },
  'next/head': { default: ({ children }) => children, __esModule: true },
}

function loadPage() {
  const code = ts.transpileModule(
    fs.readFileSync('pages/listings/index.tsx', 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2020,
      },
    }
  ).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    // eslint-disable-line no-new-func
    (name) => mocks[name] || require(name),
    module,
    module.exports
  )
  return module.exports
}

function context() {
  return {
    query: {},
    req: {},
    res: {
      statusCode: 200,
      setHeader() {},
    },
  }
}

function assertSerializableProps(result) {
  assert(result && result.props)
  assert.doesNotThrow(() => JSON.stringify(result.props))
  assert.deepEqual(result.props.query, { search: '', sort: 'newest' })
  assert.equal(
    Object.values(result.props.query).includes(undefined),
    false,
    'Next.js SSR props must not contain undefined query values'
  )
}

async function main() {
  const page = loadPage()

  const success = await page.getServerSideProps(context())
  assertSerializableProps(success)

  failListings = true
  const failureContext = context()
  const failure = await page.getServerSideProps(failureContext)
  assert.equal(failureContext.res.statusCode, 503)
  assertSerializableProps(failure)

  console.log(
    'PASS: /listings SSR success and error props omit undefined query values.'
  )
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
