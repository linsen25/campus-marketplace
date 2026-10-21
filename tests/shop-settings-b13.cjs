// Actual typed transport/mapping with controlled fetch; no env files or network.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const ts = require('typescript')
const moduleUnderTest = { exports: {} }
new Function(
  'require',
  'module',
  'exports',
  ts.transpileModule(fs.readFileSync('lib/shop-profile-api.ts', 'utf8'), {
    compilerOptions: { module: 1, target: 7 },
  }).outputText
)(require, moduleUnderTest, moduleUnderTest.exports)
const {
  requestOwnShop,
  ownerShopPreview,
  shopIdentityPatch,
  ShopProfileError,
} = moduleUnderTest.exports
const shop = {
  id: 'shop-a',
  ownerId: 'owner-a',
  name: 'My Shop',
  category: 'Electronics',
  description: 'Owner information',
  createdAt: '2026-10-19T00:00:00Z',
  updatedAt: '2026-10-19T12:34:56.123456+00:00',
}
async function main() {
  let status = 200,
    body = shop
  const calls = []
  const previous = global.fetch
  global.fetch = async (url, options) => {
    calls.push({ url, options })
    return {
      ok: status === 200,
      status,
      json: async () => body,
      headers: { get: (key) => (key === 'ETag' ? '"shop-fixture"' : null) },
    }
  }
  try {
    assert.deepEqual(await requestOwnShop(), { shop, etag: '"shop-fixture"' })
    assert.equal(calls[0].options.credentials, 'same-origin')
    assert.equal(calls[0].options.cache, 'no-store')
    assert.equal(calls[0].options.method, 'GET')
    for (const [input, expected] of [
      [{ shopName: 'New' }, { name: 'New' }],
      [{ category: 'Collectibles' }, { category: 'Collectibles' }],
      [{ description: 'Changed' }, { description: 'Changed' }],
    ]) {
      await requestOwnShop(shopIdentityPatch(input), '"shop-fixture"')
      const { url, options } = calls.at(-1)
      assert.equal(url, '/api/shop')
      assert.equal(options.method, 'PATCH')
      assert.equal(options.headers['If-Match'], '"shop-fixture"')
      assert.equal(options.headers['X-Marketplace-Request'], '1')
      assert.deepEqual(JSON.parse(options.body), expected)
    }
    assert.deepEqual(ownerShopPreview(shop, 'real_username'), {
      sellerProfileId: 'owner-a',
      username: 'real_username',
      shopName: 'My Shop',
      category: 'Electronics',
      description: 'Owner information',
    })
    assert.equal(ownerShopPreview(shop, null).username, '')
    body = null
    assert.equal((await requestOwnShop()).shop, null)
    for (const code of [400, 401, 403, 404, 409, 503]) {
      status = code
      body = { error: 'Safe failure' }
      await assert.rejects(
        requestOwnShop(),
        (e) =>
          e instanceof ShopProfileError &&
          e.status === code &&
          e.message === 'Safe failure'
      )
    }
    const sidebar = fs.readFileSync(
      'components/home/animated-sidebar-demo.tsx',
      'utf8'
    )
    assert.equal(
      (sidebar.match(/useOwnShopProfile\(active === 'settings'\)/g) || [])
        .length,
      1
    )
    assert.equal((sidebar.match(/ownShop=\{ownShop\}/g) || []).length, 2)
    assert.equal(
      (sidebar.match(/key=\{seller\?\.id \|\| 'anonymous-settings'\}/g) || [])
        .length,
      2
    )
    assert(calls.every((c) => c.options.method !== 'POST'))
    console.log(
      'PASS B13 actual client: GET/null/status, partial PATCH/headers, exact timestamps, DTO mapping/current username, single responsive owner source and both keyed Settings branches; no provisioning'
    )
  } finally {
    global.fetch = previous
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
