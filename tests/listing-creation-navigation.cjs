// Legacy routing and visible navigation contract; no real sessions or requests.
const fs = require('node:fs'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const nav = fs.readFileSync('components/home/animated-sidebar-demo.tsx', 'utf8')
const visible = nav.slice(
  nav.indexOf('const groups:'),
  nav.indexOf('// eslint-disable-next-line complexity')
)
assert(!/id: 'create-listing'/.test(visible))
assert(!/id: 'create-shop-listing'/.test(visible))
for (const id of [
  'my-listings',
  'favorites',
  'my-shop',
  'shop-favorites',
  'shop-analysis',
])
  assert(visible.includes("id: '" + id + "'"))
const moduleFixture = { exports: {} }
let signedIn = false
const code = ts.transpileModule(
  fs.readFileSync('pages/listings/new.tsx', 'utf8'),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
  }
).outputText
new Function('require', 'module', 'exports', code)(
  () => ({
    getMarketplaceSession: () =>
      Promise.resolve(signedIn ? { id: 'fixture-owner' } : null),
  }),
  moduleFixture,
  moduleFixture.exports
)
async function run() {
  assert.equal(
    (await moduleFixture.exports.getServerSideProps({})).redirect.destination,
    '/auth/sign-in?next=/listings/new'
  )
  signedIn = true
  assert.equal(
    (await moduleFixture.exports.getServerSideProps({})).redirect.destination,
    '/home?section=create-listing'
  )
  assert.equal(moduleFixture.exports.default(), null)
  console.log(
    'PASS no visible create nav destinations; peer management/favorites/analysis retained; legacy /listings/new preserves authentication and redirects to the one sheet'
  )
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
