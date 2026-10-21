const { testPictureDataUrl } = require('../scripts/lib/test-pictures.cjs')
/* global window, document, getComputedStyle */
// Actual management, card, form and modal components; offline requests only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(
    root,
    'products-' + Object.keys(aliases).length + '.tsx'
  )
  fs.writeFileSync(file, source)
  aliases[name] = file
  if (name.startsWith('@/')) aliases['./' + path.basename(name)] = file
}
mock(
  '@/components/listings/marketplace-session',
  `export function useMarketplaceSession(){return {seller:{id:'owner',displayName:'Fixture'},loading:false,error:''}}`
)
mock(
  '@/hooks/use-message-seller',
  `export function useMessageSeller(){return {contact(){throw Error('Buyer action')},busy:false}}`
)
mock(
  '@/components/listings/use-listing-offer-context',
  `export function useListingOfferContext(){return {enabled:false}}`
)
mock(
  '@/lib/listings-api',
  `export async function getMyListings(q){window.reads.push(q.channel);return window.items};export async function updateListing(id,patch){const old=window.items.find(x=>x.id===id);if(old.listingChannel!=='shop')throw Error('Channel crossover');window.updates.push({id,patch});const next={...old,...patch};window.items=window.items.map(x=>x.id===id?next:x);return next};export async function createListing(){window.creates++;throw Error('Unexpected creation')};export async function deleteListing(){throw Error('Unexpected delete')};export async function markListingSold(){throw Error('Unexpected sold')};export async function marketplaceRequest(){throw Error('Unexpected request')}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{HomeListings}from'@/components/listings/home-listings';import{demoShopProducts}from'@/components/shops/shop-demo-data';import{SectionHeader}from'@/components/home/section-header';import{ShopManagementTitle}from'@/components/listings/shop-management-title';const root=createRoot(document.getElementById('root'));const guard=()=>{};function App({initial}){const[page,setPage]=useState(initial);return <LazyMotion features={domAnimation}><main style={{padding:24}}><SectionHeader title={initial==='my-shop'?<ShopManagementTitle/>:'Manage Resale'} /><HomeListings demoProducts={window.explicitDemo?demoShopProducts.slice(0,6).map(p=>p.listing):undefined} page={page} onSelect={setPage} onGuardChange={guard}/></main></LazyMotion>};let v=0;window.renderCase=(initial)=>root.render(<App key={++v} initial={initial}/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f1fa;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
async function run() {
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route('**/*', (r) => {
        const u = new URL(r.request().url())
        assert.equal(u.origin, 'http://localhost:4177')
        if (u.pathname === '/api/places/autocomplete')
          return r.fulfill({ json: { suggestions: [] } })
        if (
          u.pathname.startsWith('/static/testPic/') ||
          u.pathname.startsWith('/static/images/') ||
          u.pathname.startsWith('/demo/')
        )
          return r.fulfill({
            path: path.resolve('public', '.' + u.pathname),
            contentType: u.pathname.endsWith('.webp')
              ? 'image/webp'
              : 'image/jpeg',
          })
        assert(['/', '/bundle.js'].includes(u.pathname))
        return r.fulfill({
          path: path.join(
            root,
            u.pathname === '/bundle.js' ? 'bundle.js' : 'index.html'
          ),
          contentType:
            u.pathname === '/bundle.js'
              ? 'application/javascript'
              : 'text/html',
        })
      })
      await p.addInitScript({
        content:
          'window.fixturePhoto=' +
          JSON.stringify(testPictureDataUrl('deskLamp')),
      })
      await p.goto('http://localhost:4177/')
      await p.evaluate(() => {
        window.reads = []
        window.updates = []
        window.creates = 0
        const base = {
          price: 2500,
          currency: 'CAD',
          status: 'available',
          publishedAt: '2026-10-16',
          createdAt: '2026-10-16',
          category: 'Home & Dorm',
          subcategory: 'Lighting & Decor',
          condition: 'good',
          description: 'Working product',
          preferredPaymentMode: 'uu_pay',
          preferredFulfillment: 'ON_CAMPUS',
          meetingLocation: { label: 'Library' },
          photoUrls: [window.fixturePhoto],
          seller: { id: 'owner', displayName: 'Fixture' },
        }
        window.items = [
          ...Array.from({ length: 6 }, (_, i) => ({
            ...base,
            id: 'shop-' + i,
            title: i === 0 ? 'Shop Lamp' : 'Shop Product ' + i,
            listingChannel: 'shop',
          })),
          {
            ...base,
            id: 'sold',
            title: 'Sold Product',
            status: 'sold',
            listingChannel: 'shop',
          },
          {
            ...base,
            id: 'resale',
            title: 'Resale only',
            listingChannel: 'resale',
          },
        ]
        window.renderCase('my-shop')
      })
      const region = p.getByRole('region', {
        name: 'Manage Products',
        exact: true,
      })
      const cards = region.locator('[data-shop-management-card]')
      await cards.first().waitFor()
      assert.equal(await cards.count(), 6)
      assert.equal(
        await region.locator('[data-shop-management-demo]').count(),
        0,
        'real products replace demo'
      )
      assert.equal(
        await region.getByText('Resale only', { exact: true }).count(),
        0
      )
      assert((await p.evaluate(() => window.reads)).every((x) => x === 'shop'))
      assert.equal(
        await region.getByRole('button', { name: /Newest|Sort/ }).count(),
        0
      )
      assert.equal(
        await region.getByRole('button', { name: /favorite/i }).count(),
        0
      )
      assert.equal(
        await region
          .getByRole('button', { name: 'Edit Product', exact: true })
          .count(),
        6
      )
      const add = region.getByRole('button', {
          name: width < 1024 ? 'Add' : 'Add Product',
          exact: true,
        }),
        filter = region.getByRole('button', { name: 'Filter', exact: true }),
        tabs = region.getByRole('tablist')
      const [a, f, t] = await Promise.all([
        add.boundingBox(),
        filter.boundingBox(),
        tabs.boundingBox(),
      ])
      assert(a.x >= t.x + t.width - 1 && f.x >= a.x + a.width - 1)
      assert(
        Math.abs(a.y - f.y) < 2 && Math.abs(a.y - t.y) < 3,
        'one control row'
      )
      assert.equal(
        await add.evaluate((n) => getComputedStyle(n).backgroundColor),
        'rgb(21, 128, 61)'
      )
      assert.equal(
        await tabs.evaluate((n) =>
          getComputedStyle(n)
            .getPropertyValue('--fluid-tabs-active-background')
            .trim()
        ),
        '#15803d'
      )
      const editButton = cards
        .first()
        .getByRole('button', { name: 'Edit Product', exact: true })
      assert(
        await editButton.evaluate((node) => {
          const text = [...node.childNodes].find(
            (n) => n.nodeType === 3 && n.textContent.trim()
          )
          const range = document.createRange()
          range.selectNode(text)
          const label = range.getBoundingClientRect(),
            box = node.getBoundingClientRect()
          return label.left >= box.left && label.right <= box.right
        }),
        'Edit Product label fits its action slot'
      )
      const grid = await cards
        .first()
        .evaluate(
          (n) =>
            getComputedStyle(n.parentElement).gridTemplateColumns.split(' ')
              .length
        )
      assert.equal(grid, width >= 1024 ? 5 : 2)
      const search = region.getByRole('searchbox', {
        name: 'Search your products',
      })
      assert(await search.isVisible())
      const searchBox = await search.boundingBox()
      if (width < 1024)
        assert(
          searchBox.y >= f.y + f.height &&
            Math.abs(searchBox.width - (width - 48)) < 2
        )
      else
        assert(
          searchBox.x + searchBox.width <= a.x &&
            Math.abs(searchBox.y - a.y) < 2,
          'desktop Search before Add Product'
        )
      assert.equal(
        await add.evaluate((n) => getComputedStyle(n).borderTopColor),
        'rgba(0, 0, 0, 0)'
      )
      await search.fill('lamp')
      await p.waitForTimeout(60)
      assert.equal(await cards.count(), 1)
      await search.fill('Resale only')
      await p.waitForTimeout(60)
      assert.equal(await cards.count(), 0)
      await region
        .getByText('No products match your search.', { exact: true })
        .waitFor()
      await search.fill('')
      await filter.click()
      const panel = p.getByRole('combobox', { name: 'Category', exact: true })
      await panel.waitFor()
      assert(await panel.isVisible())
      await panel.click()
      assert(
        await p
          .getByRole('listbox', { name: 'Category', exact: true })
          .evaluate((n) => n.parentElement.matches(':popover-open'))
      )
      await p.getByRole('option', { name: 'Home & Dorm', exact: true }).click()
      await p.getByRole('button', { name: 'Cancel', exact: true }).click()
      await p.waitForTimeout(300)
      await filter.click()
      await panel.waitFor()
      await panel.click()
      await p.getByRole('option', { name: 'Home & Dorm', exact: true }).click()
      await p.getByRole('button', { name: 'Confirm', exact: true }).click()
      await p.waitForTimeout(300)
      assert.equal(await cards.count(), 6)
      await region.getByRole('tab', { name: 'Sold', exact: true }).click()
      await p.waitForTimeout(300)
      assert.equal(await cards.count(), 1)
      assert(
        await cards
          .first()
          .getByRole('button', { name: 'Edit Product', exact: true })
          .isDisabled()
      )
      await region.getByRole('tab', { name: 'Active', exact: true }).click()
      await p.waitForTimeout(300)
      await add.click()
      const create = p.getByRole('dialog', { name: 'Add Product', exact: true })
      await create.locator('[data-multi-step-form="0"]').waitFor()
      assert.equal(
        await create.getAttribute('data-listing-creation-sheet'),
        'shop'
      )
      assert.equal(await create.locator('input[type=file]').count(), 1)
      await create
        .getByRole('button', { name: 'Close Add Product', exact: true })
        .click()
      await create.waitFor({ state: 'detached' })
      assert.equal(await p.evaluate(() => window.creates), 0)
      await cards
        .filter({ hasText: 'Shop Lamp' })
        .getByRole('button', { name: 'Edit Product', exact: true })
        .click()
      const edit = p.getByRole('dialog', { name: 'Edit Product', exact: true })
      await edit.waitFor()
      assert.equal(
        await edit.getAttribute('data-listing-creation-sheet'),
        'shop'
      )
      assert.equal(
        await edit.getAttribute('data-listing-creation-mode'),
        'edit'
      )
      assert.equal(
        await edit.getByRole('progressbar').getAttribute('aria-valuemax'),
        '4'
      )
      assert.equal(
        await edit.locator('input[name=title]').inputValue(),
        'Shop Lamp'
      )
      await edit.locator('input[name=title]').fill('Updated Shop Lamp')
      for (let n = 1; n <= 3; n++) {
        await edit
          .getByRole('button', { name: 'Continue', exact: true })
          .click()
        await edit.locator('[data-multi-step-form="' + n + '"]').waitFor()
        await p.waitForTimeout(60)
      }
      assert.equal(
        await edit.locator('[data-review-channel="shop"]').count(),
        1
      )
      await edit
        .getByRole('button', { name: 'Save Changes', exact: true })
        .click()
      await edit.waitFor({ state: 'detached' })
      await cards.filter({ hasText: 'Updated Shop Lamp' }).waitFor()
      const updates = await p.evaluate(() => window.updates)
      assert.equal(updates.length, 1)
      assert.equal(updates[0].id, 'shop-0')
      assert(!('listingChannel' in updates[0].patch))
      assert.equal(
        await p.evaluate(
          () => window.items.find((x) => x.id === 'shop-0').listingChannel
        ),
        'shop'
      )
      assert.equal(
        await p
          .getByRole('heading', { name: /Manage Products/ })
          .locator('svg')
          .count(),
        2
      )
      assert.equal(
        await p.locator('[data-shop-pro-badge]').isVisible(),
        width >= 640
      )
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      assert.deepEqual(errors, [])
      await p.screenshot({
        path: path.join(root, 'manage-products-' + width + '.png'),
      })
      await p.evaluate(() => window.renderCase('my-listings'))
      const resale = p.getByRole('region', {
        name: 'Manage Resale',
        exact: true,
      })
      await resale.locator('[data-resale-management-card]').waitFor()
      assert.equal(
        await resale.locator('[data-resale-management-card]').count(),
        1
      )
      assert.equal(await resale.getByRole('searchbox').count(), 0)
      await p.evaluate(() => {
        window.explicitDemo = true
        window.items = window.items.filter(
          (item) => item.listingChannel === 'resale'
        )
        window.renderCase('my-shop')
      })
      const demo = p.getByRole('region', {
        name: 'Manage Products',
        exact: true,
      })
      await demo.locator('[data-shop-management-demo]').waitFor()
      assert(
        (await p.evaluate(() => window.reads)).includes('shop'),
        'explicit fixture reads Shop authority before isolated demo projection'
      )
      assert.equal(await demo.locator('[data-shop-management-card]').count(), 6)
      for (const button of await demo
        .getByRole('button', { name: 'Edit Product', exact: true })
        .all())
        assert(await button.isDisabled())
      for (const button of await demo
        .getByRole('button', { name: /Listing actions for/ })
        .all())
        assert(await button.isDisabled())
      const demoSearch = demo.getByRole('searchbox', {
        name: 'Search your products',
      })
      await demoSearch.fill('beaded')
      assert.equal(await demo.locator('[data-shop-management-card]').count(), 1)
      await demoSearch.fill('Resale only')
      assert.equal(await demo.locator('[data-shop-management-card]').count(), 0)
      await demoSearch.fill('')
      await demo.getByRole('button', { name: 'Filter', exact: true }).click()
      await p.getByRole('combobox', { name: 'Category', exact: true }).click()
      await p.getByRole('option', { name: 'Home & Dorm', exact: true }).click()
      await p.getByRole('button', { name: 'Confirm', exact: true }).click()
      await p.waitForTimeout(300)
      assert.equal(await demo.locator('[data-shop-management-card]').count(), 1)
      await demo.getByRole('tab', { name: 'Sold', exact: true }).click()
      await p.waitForTimeout(300)
      assert.equal(await demo.locator('[data-shop-management-card]').count(), 0)
      await demo.getByRole('tab', { name: 'Active', exact: true }).click()
      await p.waitForTimeout(300)
      await demo
        .getByRole('button', {
          name: width < 1024 ? 'Add' : 'Add Product',
          exact: true,
        })
        .click()
      const locked = p.getByRole('dialog', { name: 'Add Product', exact: true })
      await locked.locator('[data-multi-step-form="0"]').waitFor()
      await locked
        .getByRole('button', { name: 'Close Add Product', exact: true })
        .click()
      await locked.waitFor({ state: 'detached' })
      assert.equal(await p.evaluate(() => window.creates), 0)
      assert.equal(await p.evaluate(() => window.updates.length), 1)
      // A subsequent successful inventory refresh replaces preview, never mixes it.
      await p.evaluate(() => {
        window.items.push({
          ...window.items[0],
          id: 'new-real-shop',
          title: 'Real Shop Product',
          listingChannel: 'shop',
        })
        window.dispatchEvent(new window.Event('marketplace-listings-changed'))
      })
      await demo.getByText('Real Shop Product', { exact: true }).waitFor()
      assert.equal(await demo.locator('[data-shop-management-demo]').count(), 0)
      assert.equal(await demo.locator('[data-shop-management-card]').count(), 1)
      await p.evaluate(() => {
        window.items = window.items.filter(
          (item) => item.listingChannel !== 'shop'
        )
        window.dispatchEvent(new window.Event('marketplace-listings-changed'))
      })
      await demo.locator('[data-shop-management-demo]').waitFor()

      await p.waitForTimeout(350)
      await p.screenshot({
        path: path.join(root, 'manage-products-demo-' + width + '.png'),
      })
      console.log(
        'PASS Manage Products',
        width,
        'shared geometry; green identity; shop-only search/filter; shared Add wizard; Shop UPDATE modal; Resale isolation'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
