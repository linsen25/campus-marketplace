/* global window, document, getComputedStyle */
// Offline actual Shop Directory/Listing cards; no credentials or hosted services.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const source = fs.readFileSync(
  'tests/published-listing-card.browser.cjs',
  'utf8'
)
const { root, build, aliases, mock } = new Function(
  'require',
  source.slice(0, source.indexOf('async function main()')) +
    ';return {root,build,aliases,mock}'
)(require)
mock(
  'shop-browse-api',
  `export async function getListings(query){window.reads.push(query);if(query.page>1&&query.pageSize===25)await new Promise(resolve=>setTimeout(resolve,300));if(window.fixtureCase==='error')throw Error('Controlled failure');if(window.fixtureCase==='slow')await new Promise(resolve=>window.release=resolve);const rows=window.rows;return rows.slice((query.page-1)*query.pageSize,query.page*query.pageSize)}export async function getListing(){return window.listing};export async function marketplaceRequest(url,method){if(method==='GET'&&url.startsWith('/api/offers?'))return {activeOfferId:null,orderId:null,hasHistory:false,available:true};throw Error('Unexpected API')}`,
  ['@/lib/listings-api']
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{LazyMotion,domAnimation}from'framer-motion';import{ShopDirectory}from'@/components/shops/shop-directory';import{ShopDirectoryControls}from'@/components/shops/shop-directory-controls';import{defaultShopDirectoryQuery}from'@/lib/shop-directory';import{demoShopProducts}from'@/components/shops/shop-demo-data';import market from '@/components/listings/market-layout.module.css';
const root=createRoot(document.getElementById('root'));window.actions=[];window.writes=[];window.favorited=false;window.viewer={id:'buyer'};window.reads=[];
// Large boundary datasets exist ONLY in this browser test, never application fixtures.
const shops=Array.from({length:20},(_,i)=>({sellerProfileId:'test-seller-'+i,username:'test_seller_'+i,shopName:'Qualification Shop '+(i+1),category:i%2?'Tech & Electronics':'Home & Dorm',description:'Offline qualification only',imageUrl:demoShopProducts[i%12].listing.photoUrls[0]}));
const products=Array.from({length:51},(_,i)=>({...demoShopProducts[i%12].listing,id:'test-product-'+i,title:'Qualification product '+i,seller:{id:'test-seller-'+i%20,displayName:'Qualification Shop '+(i%20+1)},photoUrls:i===0?['https://uploads.example.test/real-upload.webp']:demoShopProducts[i%12].listing.photoUrls}));
function App({kind}){const[query,setQuery]=useState(defaultShopDirectoryQuery);const[detail,setDetail]=useState(false);return <LazyMotion features={domAnimation}><main className={market.page}><header data-browse-header className={market.stickyHeader} style={{height:76,padding:12,display:'flex',justifyContent:'flex-end'}}><ShopDirectoryControls query={query} onChange={setQuery}/></header><div className={market.content}>{!detail&&<nav>Shop</nav>}<ShopDirectory shops={kind==='demo'?[]:shops} query={query} onDetailActiveChange={setDetail}/></div></main></LazyMotion>}
window.showCase=kind=>{window.fixtureCase=kind;window.reads=[];window.writes=[];window.favorited=false;window.rows=kind==='demo'||kind==='empty'||kind==='slow'?[]:kind==='mixed'?[{...products[0],listingChannel:'resale'},{...products[1],status:'sold'},products[2]]:products;window.listing=products[0];flushSync(()=>root.render(<App key={kind} kind={kind}/>))};window.showCase('real');
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:white;font-family:Arial}</style><script>window.process={env:{NEXT_PUBLIC_MESSAGES_ENV:"staging",NEXT_PUBLIC_SUPABASE_URL:"https://pcaqxezdfxofysghssyo.supabase.co"}}</script><div id="root"></div><script src="bundle.js"></script>'
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
  const evidence = []
  try {
    for (const reducedMotion of ['no-preference', 'reduce'])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion,
        })
        p.setDefaultTimeout(10000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (route) => {
          const u = new URL(route.request().url())
          if (u.origin === 'https://uploads.example.test')
            return route.fulfill({
              path: path.resolve('public/static/testPic/chair.webp'),
              contentType: 'image/webp',
            })
          assert.equal(u.origin, 'http://localhost:4177')
          if (u.pathname.startsWith('/static/'))
            return route.fulfill({
              path: path.resolve('public', '.' + u.pathname),
            })
          return route.fulfill({
            path: path.join(
              root,
              u.pathname === '/' ? 'index.html' : 'bundle.js'
            ),
            contentType:
              u.pathname === '/' ? 'text/html' : 'application/javascript',
          })
        })
        await p.goto('http://localhost:4177/')
        const shops = p.getByRole('region', { name: 'All Shops', exact: true }),
          products = p.getByRole('region', {
            name: 'Popular Shop Products',
            exact: true,
          })
        const shopCards = shops.locator('[data-directory-shop]'),
          productCards = products.locator('[data-shop-product]')
        await products.locator('[data-shop-product]').first().waitFor()
        assert.equal(await shopCards.count(), 8)
        assert.equal(await productCards.count(), 25)
        const shopColumns = width >= 1024 ? 4 : width >= 640 ? 2 : 1,
          productColumns = width >= 1024 ? 5 : width >= 640 ? 3 : 2
        assert.equal(
          await shops
            .locator('[data-all-shops-grid]')
            .evaluate(
              (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length
            ),
          shopColumns
        )
        assert.equal(
          await products
            .locator('[data-shop-product-grid]')
            .evaluate(
              (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length
            ),
          productColumns
        )
        assert.equal(
          await productCards.first().locator('img').getAttribute('src'),
          'https://uploads.example.test/real-upload.webp'
        )
        assert.equal(await products.locator('[data-demo-listing]').count(), 0)
        const heading = p.getByRole('heading', {
            name: 'All Shops',
            exact: true,
          }),
          productHeading = p.getByRole('heading', {
            name: 'Popular Shop Products',
            exact: true,
          }),
          control = shops.getByRole('button', {
            name: 'View All Shops',
            exact: true,
          })
        const headingBox = await heading.boundingBox(),
          controlBox = await control.boundingBox()
        assert(
          controlBox.y >= headingBox.y + headingBox.height &&
            controlBox.y - headingBox.y - headingBox.height < 32
        )
        const carousel = await p
          .locator('[data-overlapping-slider]')
          .elementHandle()
        await control.focus()
        await p.keyboard.press('Enter')
        await shops
          .getByRole('button', { name: 'Back to Shop Overview', exact: true })
          .waitFor()
        assert.equal(await shopCards.count(), 16)
        const shopPages = shops.getByRole('navigation', { name: 'Shop pages' }),
          productPages = products.getByRole('navigation', {
            name: 'Shop product pages',
          })
        assert(
          await shopPages
            .getByRole('button', { name: 'Previous', exact: true })
            .isDisabled()
        )
        await shopPages
          .getByRole('button', { name: 'Next', exact: true })
          .click()
        await p.waitForTimeout(850)
        assert.equal(await shopCards.count(), 4)
        assert.equal(
          await shopCards.first().getAttribute('data-directory-shop'),
          'test-seller-16'
        )
        const headerBottom = (
          await p.locator('[data-browse-header]').boundingBox()
        ).height
        assert(
          Math.abs((await heading.boundingBox()).y - headerBottom - 12) < 3,
          'Shop pagination targets All Shops below sticky header'
        )
        assert.equal(await products.getAttribute('data-product-page'), '1')
        await productPages
          .getByRole('button', { name: 'Next', exact: true })
          .click()
        await p.waitForFunction(
          () =>
            document
              .querySelector('[data-shop-product]')
              ?.getAttribute('data-shop-product') === 'test-product-25'
        )
        await p.waitForTimeout(850)
        assert.equal(await productCards.count(), 25)
        assert.equal(
          await shopCards.first().getAttribute('data-directory-shop'),
          'test-seller-16'
        )
        assert(
          Math.abs((await productHeading.boundingBox()).y - headerBottom - 12) <
            3,
          'Product pagination targets Popular Shop Products'
        )
        await shops
          .getByRole('button', { name: 'Back to Shop Overview', exact: true })
          .click()
        await p.waitForTimeout(850)
        assert.equal(await shopCards.count(), 8)
        assert.equal(await products.getAttribute('data-product-page'), '2')
        assert(
          Math.abs((await heading.boundingBox()).y - headerBottom - 12) < 3
        )
        await shops
          .getByRole('button', { name: 'View All Shops', exact: true })
          .click()
        assert.equal(
          await shopCards.first().getAttribute('data-directory-shop'),
          'test-seller-16'
        )
        await productPages
          .getByRole('button', { name: 'Next', exact: true })
          .click()
        await p.waitForFunction(
          () =>
            document
              .querySelector('[data-shop-product]')
              ?.getAttribute('data-shop-product') === 'test-product-50'
        )
        assert.equal(await productCards.count(), 1)
        assert(
          await productPages
            .getByRole('button', { name: 'Next', exact: true })
            .isDisabled()
        )
        await productPages
          .getByRole('button', { name: 'Page 1', exact: true })
          .click()
        await p.waitForFunction(
          () =>
            document
              .querySelector('[data-shop-product]')
              ?.getAttribute('data-shop-product') === 'test-product-0'
        )
        const heart = productCards
          .first()
          .getByRole('button', { name: 'Add to favorites', exact: true })
        await heart.click()
        await p.waitForFunction(() => window.writes.length === 1)
        assert.equal(
          await p.evaluate(() => window.writes[0].id),
          'test-product-0'
        )
        await productCards
          .first()
          .locator('[data-slot="expandable-card"]')
          .click()
        const dialog = p.getByRole('dialog')
        await dialog.waitFor()
        assert(
          await dialog
            .getByRole('button', { name: 'Message Seller', exact: true })
            .isVisible()
        )
        assert(
          await dialog
            .getByRole('button', { name: /^Make Offer$/i })
            .isVisible()
        )
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        const firstShop = shopCards.first()
        await firstShop
          .getByRole('button', { name: 'Go to shop', exact: true })
          .click()
        await p.waitForFunction(() => window.actions.length === 1)
        assert.equal(
          await p.evaluate(() => window.actions[0]),
          '/shop/test_seller_16'
        )
        assert(
          await carousel.evaluate(
            (n) => n === document.querySelector('[data-overlapping-slider]')
          ),
          'carousel instance preserved'
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        assert(
          await p.evaluate(() =>
            window.reads.every(
              (q) =>
                q.channel === 'shop' &&
                q.status === 'available' &&
                q.pageSize <= 25
            )
          )
        )
        // Exercise real-response isolation, explicit empty/error/loading, then existing local seam.
        await p.evaluate(() => window.showCase('mixed'))
        await products.locator('[data-shop-product]').waitFor()
        assert.equal(await productCards.count(), 1)
        assert.equal(
          await productCards.first().getAttribute('data-shop-product'),
          'test-product-2'
        )
        await p.evaluate(() => window.showCase('empty'))
        await products
          .getByText('No Shop products available.', { exact: true })
          .waitFor()
        assert.equal(await productCards.count(), 0)
        await p.evaluate(() => window.showCase('error'))
        await products.getByRole('alert').waitFor()
        assert.equal(await productCards.count(), 0)
        assert.equal(
          await products
            .getByText('No Shop products available.', { exact: true })
            .count(),
          0
        )
        await p.evaluate(() => {
          window.rows = []
          window.fixtureCase = 'empty'
        })
        await products
          .getByRole('button', { name: 'Retry', exact: true })
          .click()
        await products
          .getByText('No Shop products available.', { exact: true })
          .waitFor()
        await p.evaluate(() => window.showCase('slow'))
        await products
          .getByRole('status', { name: 'Loading listings', exact: true })
          .waitFor()
        assert.equal(
          await products
            .getByText('No Shop products available.', { exact: true })
            .count(),
          0
        )
        await p.waitForFunction(() => typeof window.release === 'function')
        await p.evaluate(() => window.release())
        await products
          .getByText('No Shop products available.', { exact: true })
          .waitFor()
        await p.evaluate(() => window.showCase('demo'))
        await products.locator('[data-demo-listing]').first().waitFor()
        assert.equal(await shopCards.count(), 5)
        assert.equal(await productCards.count(), 12)
        assert.equal(await productPages.count(), 0)
        assert.equal(
          await shops.getByRole('navigation', { name: 'Shop pages' }).count(),
          0
        )
        const demoHeart = productCards
          .first()
          .getByRole('button', { name: 'Add to favorites', exact: true })
        await demoHeart.click()
        assert.equal(await p.evaluate(() => window.writes.length), 0)
        await productCards
          .first()
          .locator('[data-slot="expandable-card"]')
          .click()
        await dialog.waitFor()
        assert.equal(
          await dialog.getByRole('button', { name: /^Make Offer$/i }).count(),
          0
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: 'Message Seller', exact: true })
            .count(),
          0
        )
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        await shops
          .getByRole('button', { name: 'View All Shops', exact: true })
          .click()
        // Capture the return position after View All's existing section scroll
        // settles, rather than while that animation still moves the document.
        await p.waitForFunction(() => {
          const title = Array.from(document.querySelectorAll('h2')).find(
            (element) => element.textContent === 'All Shops'
          )
          const header = document.querySelector('[data-browse-header]')
          return (
            title &&
            header &&
            Math.abs(
              title.getBoundingClientRect().top -
                header.getBoundingClientRect().height -
                12
            ) < 3
          )
        })
        await shops
          .getByRole('button', {
            name: 'Go to Luna Studio demo shop',
            exact: true,
          })
          .scrollIntoViewIfNeeded()
        const origin = await p.evaluate(() => window.scrollY)
        await shops
          .getByRole('button', {
            name: 'Go to Luna Studio demo shop',
            exact: true,
          })
          .click()
        await p.locator('[data-shop-detail-demo]').waitFor()
        await p
          .getByRole('button', { name: 'Back to shop list', exact: true })
          .click()
        await p.locator('[data-shop-directory-content]').waitFor()
        await p.waitForTimeout(600)
        assert.equal(await shops.getAttribute('data-shop-expanded'), 'true')
        assert.equal(await productCards.count(), 12)
        assert(
          Math.abs((await p.evaluate(() => window.scrollY)) - origin) < 40,
          'returns to relevant directory position'
        )
        await shops
          .getByRole('button', { name: 'Back to Shop Overview', exact: true })
          .click()
        await p.waitForTimeout(850)
        const filter = p.getByRole('button', { name: 'Filter', exact: true })
        await filter.click()
        const form = p.getByRole('form', { name: 'Shop category filter' })
        await form
          .getByRole('checkbox', { name: 'Tech & Electronics', exact: true })
          .check()
        await form.getByRole('button', { name: 'Apply', exact: true }).click()
        await p
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
        assert.equal(await shopCards.count(), 1)
        assert.equal(
          await shopCards.first().getAttribute('data-directory-shop'),
          'demo-tech'
        )
        assert.equal(await productCards.count(), 12)
        await filter.click()
        await p
          .getByRole('form', { name: 'Shop category filter' })
          .getByRole('button', { name: 'Clear', exact: true })
          .click()
        await p
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
        assert.equal(await shopCards.count(), 5)
        await p.evaluate(() => window.scrollTo(0, 0))
        await p.screenshot({
          path: path.join(
            root,
            'shop-discovery-' + width + '-' + reducedMotion + '.png'
          ),
          fullPage: true,
        })
        evidence.push({
          width,
          reducedMotion,
          shopColumns,
          productColumns,
          overview: 5,
          localProducts: 12,
        })
        assert.deepEqual(errors, [])
        console.log(
          'PASS Shop discovery',
          width,
          reducedMotion,
          'overview/expanded, independent real pagination, anchors, real+Demo details/favorites, source isolation, states, filters, media, no overflow'
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
  fs.writeFileSync(
    path.join(root, 'shop-discovery-evidence.json'),
    JSON.stringify(evidence, null, 2)
  )
}
run().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
