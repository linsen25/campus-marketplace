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
  (name) =>
    name === '@/lib/marketplace-auth'
      ? {
          marketplaceAuthEntry: (next) =>
            `/listings?auth=signin&next=${encodeURIComponent(next)}`,
        }
      : {
          getMarketplaceSession: () =>
            Promise.resolve(signedIn ? { id: 'fixture-owner' } : null),
        },
  moduleFixture,
  moduleFixture.exports
)
async function run() {
  assert.equal(
    (await moduleFixture.exports.getServerSideProps({})).redirect.destination,
    '/listings?auth=signin&next=%2Flistings%2Fnew'
  )
  signedIn = true
  assert.equal(
    (await moduleFixture.exports.getServerSideProps({})).redirect.destination,
    '/home?section=create-listing'
  )
  assert.equal(moduleFixture.exports.default(), null)
  for (const file of [
    'pages/profile/listings.tsx',
    'pages/listings/[id]/edit.tsx',
  ]) {
    const source = fs.readFileSync(file, 'utf8')
    assert(source.includes('marketplaceAuthEntry('))
    assert(
      source.indexOf('getMarketplaceSession(') <
        source.indexOf(
          file.includes('/profile/')
            ? 'getMyListings(context)'
            : 'getListing(params.id'
        ),
      `${file} checks the server session before reading protected Listing data`
    )
  }
  const compatibility = fs.readFileSync('pages/auth/sign-in.tsx', 'utf8')
  assert(compatibility.includes('marketplaceAuthEntry(query.next)'))
  assert(!compatibility.includes('Western email required.'))
  console.log(
    'PASS no visible create nav destinations; peer management/favorites/analysis retained; legacy /listings/new preserves authentication and redirects to the one sheet'
  )
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
