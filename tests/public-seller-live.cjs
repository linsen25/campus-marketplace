/* global document, window */
// Anonymous/read-only staging route verification. No fixtures or provider writes.
const assert = require('node:assert/strict'),
  fs = require('node:fs'),
  path = require('node:path')
const env = require('../scripts/v2-maintenance-staging.cjs').environment()
const { createClient } = require('@supabase/supabase-js')
assert.equal(
  new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname,
  'pcaqxezdfxofysghssyo.supabase.co'
)
const client = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
)
async function main() {
  const active = await client
    .from('listings')
    .select('seller_id')
    .eq('status', 'available')
    .not('published_at', 'is', null)
    .limit(1)
  assert(!active.error)
  assert(
    active.data.length,
    'A public listing is available for read-only qualification'
  )
  const id = active.data[0].seller_id
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const checks = []
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      let production = 0
      await context.route(/yzvchumzyonegujucyqs[.]supabase[.]co/, (r) => {
        production++
        return r.abort()
      })
      const page = await context.newPage()
      const response = await page.goto('http://localhost:3000/seller/' + id, {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      assert.equal(response.status(), 200)
      await page.locator(`[data-public-seller-id="${id}"]`).waitFor()
      await page
        .getByText('Seller on Usual & Unusual', { exact: true })
        .waitFor()
      const seller = await page
        .locator('#__NEXT_DATA__')
        .evaluate((n) => JSON.parse(n.textContent).props.pageProps.seller)
      assert.deepEqual(Object.keys(seller).sort(), [
        'avatarUrl',
        'hasNextPage',
        'identifier',
        'listings',
        'page',
        'username',
      ])
      assert(seller.listings.length)
      for (const listing of seller.listings)
        assert.deepEqual(Object.keys(listing).sort(), [
          'id',
          'imageUrl',
          'priceCents',
          'title',
        ])
      assert.equal(
        await page.locator('[data-public-seller-id] h1').textContent(),
        seller.username
      )
      assert(
        (await page
          .locator('[aria-label="Active listings"] a[href^="/listings/"]')
          .count()) > 0
      )
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      assert.equal(
        (await context.cookies()).filter((c) => c.name.startsWith('sb-'))
          .length,
        0,
        'Public page does not need an Auth session'
      )
      assert.equal(production, 0)
      const alias = await page.goto(
        'http://localhost:3000/seller/' + encodeURIComponent(seller.username),
        { waitUntil: 'domcontentloaded', timeout: 120000 }
      )
      assert.equal(alias.status(), 200)
      await page.locator(`[data-public-seller-id="${id}"]`).waitFor()
      assert.deepEqual(
        await page
          .locator('#__NEXT_DATA__')
          .evaluate((n) => JSON.parse(n.textContent).props.pageProps.seller),
        seller
      )
      await page.screenshot({
        path: path.resolve('tests/artifacts/public-seller-' + width + '.png'),
        fullPage: true,
      })
      checks.push(width)
      console.log(
        'PASS anonymous public Seller page ' +
          width +
          '; safe projection, public listing links, no overflow'
      )
      const missing = await context.request.get(
        'http://localhost:3000/seller/00000000-0000-4000-8000-000000000000'
      )
      assert.equal(missing.status(), 404)
      const missingAlias = await context.request.get(
        'http://localhost:3000/seller/no_such_uu_seller'
      )
      assert.equal(missingAlias.status(), 404)
      await context.close()
    }
    fs.writeFileSync(
      'tests/artifacts/public-seller-live-results.json',
      JSON.stringify(
        {
          anonymous: true,
          readOnly: true,
          widths: checks,
          productionRequests: 0,
          publicDeploymentVerified: false,
        },
        null,
        2
      )
    )
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(
    e.name + ': ' + String(e.message).replace(/https?:\/\/\S+/g, '[url]')
  )
  process.exitCode = 1
})
