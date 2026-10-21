/* global window, document */
// Actual Shop components and public transport; all requests intercepted locally.
const fs = require('fs'),
  path = require('path'),
  assert = require('assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(root, 'b15-' + Object.keys(aliases).length + '.tsx')
  fs.writeFileSync(file, source)
  aliases[name] = file
}
mock('next/head', `export default function Head(){return null}`)
mock(
  'next/image',
  `import React from 'react';export default function Image({src,alt,...props}){return <img src={src} alt={alt}/>}`
)
mock(
  '@/components/listings/marketplace-session',
  `export function useMarketplaceSession(){return {seller:null}}`
)
mock(
  '@/lib/messages-api',
  `export async function findConversation(){throw Error('Shop transactions must stay closed')}`
)
mock(
  'next/router',
  `export function useRouter(){return {query:{},push:async href=>{window.navigation.push(href);window.show('shop');return true}}}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{ShopDirectory}from'@/components/shops/shop-directory';import{ShopPage}from'@/components/shops/shop-page';import ListingPage from '@/pages/listings/[id]';import{PublishedListingCard}from'@/components/listings/published-listing-card';
window.process={env:{}};window.navigation=[];const root=createRoot(document.getElementById('root'));window.show=(mode='directory')=>root.render(<LazyMotion features={domAnimation}><div key={mode} style={{padding:16}}>{mode==='resale'?<PublishedListingCard listing={{...window.listing,listingChannel:'resale'}}/>:mode==='shop'?<ShopPage shop={window.shop} listings={[window.listing]}/>:mode==='listing'?<ListingPage listing={window.listing}/>:<ShopDirectory shops={[]}/>}</div></LazyMotion>);window.addEventListener('popstate',()=>window.show());window.show();`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f1fa;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
const id = '11111111-1111-4111-8111-111111111111'
const shop = {
  id,
  sellerProfileId: id,
  username: 'real_seller',
  shopName: 'Real Shop',
  category: 'Electronics',
  description: 'Real eligible profile',
  badgeTier: 'plus',
}
const listing = {
  id,
  listingChannel: 'shop',
  title: 'Camera',
  description: 'Actual product description',
  price: 4500,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  preferredPaymentMode: 'external',
  preferredFulfillment: 'ON_CAMPUS',
  meetingLocation: { label: 'Campus' },
  estimatedDeliveryFeeCents: 0,
  status: 'available',
  seller: { id, displayName: 'real_seller' },
  photoUrls: ['/api/listing-media/22222222-2222-4222-8222-222222222222'],
  createdAt: '2026-10-19',
  updatedAt: '2026-10-19',
  publishedAt: '2026-10-19',
}
const page = { page: 1, hasNextPage: false, refreshAfterMs: 30000 }
async function main() {
  await build(aliases)
  for (const f of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, f))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const reduced of [false, true])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        let mode = 'ready'
        const errors = [],
          requests = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.addInitScript(
          ({ shop, listing }) => {
            window.shop = shop
            window.listing = listing
          },
          { shop, listing }
        )
        await p.route('**/*', async (route) => {
          const url = new URL(route.request().url())
          assert.equal(
            url.origin,
            'http://localhost:4177',
            'No external request'
          )
          if (url.pathname === '/bundle.js')
            return route.fulfill({
              path: path.join(root, 'bundle.js'),
              contentType: 'application/javascript',
            })
          if (
            url.pathname ===
            '/api/listing-media/22222222-2222-4222-8222-222222222222'
          )
            return route.fulfill({
              path: 'public/static/testPic/camera.webp',
              contentType: 'image/webp',
            })
          if (url.pathname.startsWith('/api/public-shops')) {
            requests.push(url.pathname + url.search)
            if (mode === 'error')
              return route.fulfill({
                status: 503,
                json: { error: 'Controlled query failure' },
              })
            const q = JSON.parse(url.searchParams.get('q') || '{}')
            if (url.searchParams.get('kind') === 'listing')
              return route.fulfill({
                json:
                  mode === 'suspended'
                    ? { state: 'unavailable' }
                    : { state: 'available', listing, refreshAfterMs: 30000 },
              })
            if (url.searchParams.get('kind') === 'products')
              return route.fulfill({
                json: {
                  state: 'available',
                  listings: mode === 'empty' ? [] : [listing],
                  ...page,
                },
              })
            if (url.pathname === '/api/public-shops/real_seller')
              return route.fulfill({
                json:
                  mode === 'suspended'
                    ? { state: 'unavailable' }
                    : {
                        state: 'available',
                        shop,
                        listings: mode === 'empty' ? [] : [listing],
                        ...page,
                      },
              })
            return route.fulfill({
              json: {
                shops:
                  mode === 'empty' ||
                  mode === 'suspended' ||
                  q.categories?.includes('Food & Treats')
                    ? []
                    : [shop],
                ...page,
              },
            })
          }
          if (url.pathname.startsWith('/static/'))
            return route.fulfill({ path: 'public' + url.pathname })
          assert(
            !url.pathname.startsWith('/api/'),
            'No Offers/Messages/Favorites requests'
          )
          return route.fulfill({
            path: path.join(root, 'index.html'),
            contentType: 'text/html',
          })
        })
        await p.goto('http://localhost:4177/listings')
        const card = p.getByRole('article', {
          name: 'Real Shop shop',
          exact: true,
        })
        await card.waitFor({ timeout: 8000 }).catch(async (e) => {
          console.error({
            errors,
            requests,
            body: (await p.locator('body').innerText()).slice(0, 2000),
          })
          throw e
        })
        await p.waitForTimeout(800) // Let the existing entrance animation settle for screenshots.
        await p.screenshot({
          path: path.join(
            root,
            'b15-directory-' +
              width +
              '-' +
              (reduced ? 'reduced' : 'normal') +
              '.png'
          ),
        })
        assert.equal(await p.getByText(/Illustrative|Demo shop/).count(), 0)
        assert.equal(
          await card.getByRole('button', { name: /Favorite/ }).count(),
          1,
          'B16 approved Shop entity heart; product transaction controls remain closed'
        )
        await card
          .getByRole('button', { name: 'Go to shop', exact: true })
          .click()
        await p
          .getByRole('heading', { name: 'Real Shop', exact: true })
          .waitFor()
        assert.deepEqual(await p.evaluate(() => window.navigation), [
          '/shop/real_seller',
        ])
        assert.equal(
          await p.locator('[data-shop-pro-badge]').innerText(),
          'PLUS+'
        )
        const product = p.locator('[data-slot="expandable-card"]')
        await product.click()
        const dialog = p.getByRole('dialog')
        await dialog.waitFor()
        assert.equal(
          await dialog
            .getByText('Actual product description', { exact: true })
            .count(),
          1
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: /Message Seller|Make Offer|Favorite/ })
            .count(),
          0
        )
        await dialog.locator('img').evaluateAll(async (images) => {
          await Promise.all(images.map((image) => image.decode()))
        })
        await p.waitForTimeout(800) // Capture the final shared-layout geometry, not its interpolation.
        await p.screenshot({
          path: path.join(
            root,
            'b15-product-' +
              width +
              '-' +
              (reduced ? 'reduced' : 'normal') +
              '.png'
          ),
        })
        await p.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        mode = 'empty'
        await p.evaluate(() => window.show('directory'))
        await p.getByText('No shops found in these categories.').waitFor()
        await p.locator('[data-shop-products="ready"]').waitFor()
        assert.equal(await p.getByRole('article').count(), 0)
        mode = 'error'
        await p.evaluate(() => window.dispatchEvent(new window.Event('focus')))
        await p
          .getByRole('region', { name: 'All Shops', exact: true })
          .getByRole('alert')
          .waitFor()
        await p.locator('[data-shop-products="error"]').waitFor()
        assert.equal(await p.getByRole('article').count(), 0)
        mode = 'suspended'
        await p.evaluate(() => window.show('shop'))
        await p
          .getByText('This shop is temporarily unavailable.', { exact: true })
          .waitFor()
        assert.equal(
          await p
            .getByRole('heading', { name: 'Real Shop', exact: true })
            .count(),
          0
        )
        await p.evaluate(() => window.show('listing'))
        await p
          .getByText('This shop is temporarily unavailable.', { exact: true })
          .waitFor()
        assert.equal(
          await p
            .getByText('Actual product description', { exact: true })
            .count(),
          0
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        await p.evaluate(() => window.show('resale'))
        await p.locator('[data-slot="expandable-card"]').click()
        const resaleDialog = p.getByRole('dialog')
        await resaleDialog.waitFor()
        assert.equal(
          await resaleDialog
            .getByRole('button', { name: 'Message Seller', exact: true })
            .count(),
          1,
          'Resale action unchanged'
        )
        assert.equal(
          await resaleDialog.getByRole('button', { name: /favorites/ }).count(),
          1,
          'Resale favorite unchanged'
        )
        await p.keyboard.press('Escape')
        await resaleDialog.waitFor({ state: 'hidden' })
        assert.deepEqual(errors, [])
        assert(requests.length > 0)
        await p.screenshot({
          path: path.join(
            root,
            'b15-' + width + '-' + (reduced ? 'reduced' : 'normal') + '.png'
          ),
        })
        await p.close()
        console.log(
          'PASS B15 browser ' + width + ' ' + (reduced ? 'reduced' : 'normal')
        )
      }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
