const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')
const React = require('react')
const { renderToStaticMarkup } = require('react-dom/server')

const cache = new Map()
const mocks = {
  '@/components/listings/homepage-scene': {
    HomepageScene: () =>
      React.createElement('div', { 'data-testid': 'landing-scene' }),
  },
  'next/head': { default: ({ children }) => children, __esModule: true },
}

function resolveLocal(from, name) {
  const base = name.startsWith('@/')
    ? path.resolve(name.slice(2))
    : path.resolve(path.dirname(from), name)
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate
  }
  return null
}

function load(file) {
  const absolute = path.resolve(file)
  if (cache.has(absolute)) return cache.get(absolute).exports
  const code = ts.transpileModule(fs.readFileSync(absolute, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2020,
    },
  }).outputText
  const module = { exports: {} }
  cache.set(absolute, module)
  new Function('require', 'module', 'exports', code)(
    // eslint-disable-line no-new-func
    (name) => {
      if (mocks[name]) return mocks[name]
      const local = resolveLocal(absolute, name)
      return local ? load(local) : require(name)
    },
    module,
    module.exports
  )
  return module.exports
}

function main() {
  const fixture = load('lib/fixtures/hero-parallax-demo-products.ts')
  const products = fixture.heroParallaxDemoProducts
  assert.equal(products.length, 21)
  assert.equal(new Set(products.map((product) => product.id)).size, 21)
  assert.equal(products[0].title, 'Laptop and study essentials')
  assert.equal(products.at(-1).title, 'Wireless controller')
  for (const product of products) {
    assert.equal('href' in product, false)
    assert(product.image.startsWith('/static/testPic/'))
    assert(fs.existsSync(path.join('public', product.image)))
  }

  const welcome = load('pages/index.tsx')
  assert.equal(welcome.getServerSideProps, undefined)
  const html = renderToStaticMarkup(React.createElement(welcome.default))
  assert.match(html, /landing-scene/)
  assert(!html.includes('No listing photos are available yet.'))

  console.log(
    'PASS: Welcome uses 21 fixed, non-navigating Hero products and has no Listing SSR dependency.'
  )
}

try {
  main()
} catch (error) {
  console.error(error)
  process.exitCode = 1
}
