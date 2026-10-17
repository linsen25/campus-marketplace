// Offline public-route boundary: no membership inference, cookies, network or DB.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
function load(file, dependencies = {}) {
  const module = { exports: {} }
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: 1, jsx: 4, target: 7, esModuleInterop: true },
  }).outputText
  new Function('require', 'module', 'exports', code)(
    (name) => {
      if (Object.hasOwn(dependencies, name)) return dependencies[name]
      if (name === 'react/jsx-runtime') return require(name)
      throw Error('Unexpected public Shop dependency: ' + name)
    },
    module,
    module.exports
  )
  return module.exports
}
async function main() {
  const source = load('lib/server/public-shop.ts')
  assert.deepEqual(source.getPublicShops(), [])
  for (const username of [
    'fixture_shop',
    'demo_seller_a',
    '../home',
    '',
    'x'.repeat(65),
  ])
    assert.equal(source.getPublicShop(username), null)
  const route = load('pages/shop/[username].tsx', {
    'next/head': () => null,
    '@/components/shops/shop-page': { ShopPage: () => null },
    '@/lib/server/public-shop': source,
  })
  const headers = {}
  for (const username of [
    'fixture_shop',
    'demo_seller_a',
    ['invalid'],
    undefined,
  ]) {
    const result = await route.getServerSideProps({
      params: { username },
      // Deliberately no auth request/cookies: this is a public route.
      res: {
        setHeader: (key, value) => {
          headers[key] = value
        },
      },
    })
    assert.deepEqual(result, { notFound: true })
  }
  assert.equal(headers['Cache-Control'], 'no-store, max-age=0')
  console.log(
    'PASS public Shop boundary: empty authoritative source, no inferred PRO, no fixture routes, public/no-store'
  )
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
