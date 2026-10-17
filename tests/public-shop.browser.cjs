/* global window, document, getComputedStyle */
// Isolated presentation fixtures only. Real Shop/Card/feed and existing listing
// interaction hooks; controlled API responses, no hosted reads/writes or credentials.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(root, name + '.jsx')
  fs.writeFileSync(file, source)
  return file
}
aliases['@/components/listings/marketplace-session'] = mock(
  'shop-session',
  `export function useMarketplaceSession(){return {seller:window.viewer}}`
)
aliases[path.resolve('components/listings/marketplace-session')] =
  aliases['@/components/listings/marketplace-session']
aliases['@/components/auth/auth-modal'] = mock(
  'shop-auth',
  `export function useAuthModal(){return {openAuth:options=>window.auth.push(options.intent)}}`
)
aliases['@/components/navigation/desktop-route-transition'] = mock(
  'shop-navigation',
  `export function useDesktopRouteTransition(){return ()=>{}}`
)
aliases['@ui/link/link'] = mock(
  'shop-link',
  `import React from 'react';export function Link({href,children,...props}){return <a {...props} href={href} onClick={e=>{e.preventDefault();history.pushState({},'',href);window.show('page')}}>{children}</a>}`
)
aliases['@/lib/messages-api'] = mock(
  'shop-messages',
  `export async function findConversation(id,contact){window.contacts.push({id,contact});return {id:'existing-listing-conversation',role:'buying'}}`
)
aliases['@/lib/listings-api'] = mock(
  'shop-requests',
  `export async function getListing(){return window.listing};export async function marketplaceRequest(url,method,body){window.requests.push({url,method,body});if(url.startsWith('/api/offers'))return {available:true,hasHistory:false,activeOfferId:null,orderId:null};if(url.startsWith('/api/favorites'))return {favorited:method==='POST'};throw Error('Unexpected fixture request '+url)}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {ShopDirectory} from '@/components/shops/shop-directory';import {ShopPage} from '@/components/shops/shop-page';import {PublishedListingCard} from '@/components/listings/published-listing-card';import grid from '@/components/infinite-grid.module.css';
window.process={env:{NEXT_PUBLIC_MESSAGES_ENV:'staging',NEXT_PUBLIC_SUPABASE_URL:'https://pcaqxezdfxofysghssyo.supabase.co'}};
const shop={sellerProfileId:'fixture-seller',username:'fixture_shop',shopName:'Vintage Loop',category:'Clothing & Accessories',description:'Curated clothing and accessories around campus. A deliberately longer presentation description to exercise the collapsed three-line clamp without creating any membership or subscription.'};
window.listing={id:'fixture-listing',title:'Ordinary UU Listing',description:'Existing listing detail content',price:8000,currency:'CAD',category:'Clothing & Accessories',subcategory:'Shoes',condition:'good',photoUrls:['data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="600" height="600"%3E%3Crect width="600" height="600" fill="purple"/%3E%3C/svg%3E'],seller:{id:'fixture-seller',displayName:'Fixture Seller'},status:'available',createdAt:'2026-10-16T12:00:00Z',updatedAt:'2026-10-16T12:00:00Z'};
window.viewer=null;window.auth=[];window.actions=[];window.contacts=[];window.requests=[];
const root=createRoot(document.getElementById('root'));
window.show=(mode='directory')=>{flushSync(()=>root.render(<LazyMotion features={domAnimation}><div key={mode+String(window.viewer?.id)} style={{padding:20}}>{mode==='empty'?<ShopDirectory/>:mode==='page'?<ShopPage shop={shop} listings={[window.listing]}/>:mode==='resale'?<div className={grid.grid}><PublishedListingCard listing={window.listing}/></div>:<ShopDirectory shops={[shop]}/>}</div></LazyMotion>))};window.addEventListener('popstate',()=>window.show());window.show();
`
)
async function main() {
  await build(aliases)
  for (const file of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, file))
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
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        let network = 0
        await p.route('**/*', (r) => {
          const url = new URL(r.request().url())
          if (url.origin !== 'http://localhost:4177') {
            network++
            return r.abort()
          }
          if (url.pathname === '/bundle.js')
            return r.fulfill({
              path: path.join(root, 'bundle.js'),
              contentType: 'application/javascript',
            })
          return r.fulfill({
            path: path.join(root, 'index.html'),
            contentType: 'text/html',
          })
        })
        await p.goto('http://localhost:4177/listings')
        const trigger = p.getByRole('button', {
          name: 'Open shop: Vintage Loop',
          exact: true,
        })
        await trigger.waitFor()
        const geometry = async (locator) =>
          locator.evaluate((n) => {
            const r = n.getBoundingClientRect(),
              s = getComputedStyle(n)
            return {
              width: r.width,
              ratio: s.aspectRatio,
              radius: s.borderRadius,
            }
          })
        const shopMedia = await geometry(trigger.locator('span').first())
        assert.equal(await trigger.getByText('CA$80.00').count(), 0)
        const badge = await trigger
          .getByText('PRO', { exact: true })
          .evaluate((n) => ({
            color: getComputedStyle(n).color,
            bg: getComputedStyle(n).backgroundColor,
          }))
        assert.deepEqual(badge, {
          color: 'rgb(0, 0, 0)',
          bg: 'rgb(74, 222, 128)',
        })
        assert.equal(
          await trigger.getByText('Vintage Loop', { exact: true }).count(),
          1
        )
        await trigger.click()
        let dialog = p.getByRole('dialog')
        await dialog.waitFor()
        assert.equal(
          await dialog.locator('[data-slot="expanded-price"]').count(),
          0
        )
        assert.equal(
          await dialog
            .getByRole('link', { name: 'View Shop' })
            .getAttribute('href'),
          '/shop/fixture_shop'
        )
        assert.equal(await dialog.getByText('PRO', { exact: true }).count(), 1)
        assert.equal(await dialog.locator('[data-market-grid]').count(), 0)
        const expanded = await geometry(
          dialog.locator('[class*="_media"]').first()
        )
        assert(
          await dialog.evaluate((n) => {
            const r = n.getBoundingClientRect()
            return (
              r.left >= 0 &&
              r.right <= window.innerWidth &&
              n.scrollWidth <= n.clientWidth
            )
          })
        )
        if (!reduced && [390, 1280].includes(width)) {
          await p.waitForTimeout(700)
          await p.screenshot({
            path: path.join(root, `shop-expanded-${width}.png`),
          })
        }
        await dialog.getByRole('link', { name: 'View Shop' }).click()
        await p
          .getByRole('heading', { name: 'Vintage Loop', exact: true })
          .waitFor()
        assert.equal(new URL(p.url()).pathname, '/shop/fixture_shop')
        assert.equal(await p.getByRole('dialog').count(), 0)
        await p.waitForFunction(
          () => document.querySelectorAll('[data-market-card]').length === 1
        )
        const columns = await p
          .locator('[data-market-grid] > div')
          .evaluate(
            (n) => getComputedStyle(n).gridTemplateColumns.split(' ').length
          )
        assert.equal(
          columns,
          width < 640 ? 2 : width < 1024 ? 3 : width < 1440 ? 4 : 5
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        if (!reduced && [390, 1280].includes(width))
          await p.screenshot({
            path: path.join(root, `shop-page-${width}.png`),
          })
        const listing = p.locator('[data-slot="expandable-card"]')
        const listingMedia = await geometry(listing.locator('span').first())
        // Card media is the exact current Resale geometry, not another product card.
        assert.equal(listingMedia.ratio, shopMedia.ratio)
        assert.equal(listingMedia.radius, shopMedia.radius)
        await listing.click()
        dialog = p.getByRole('dialog')
        await dialog.waitFor()
        assert.equal(
          await dialog.getByText('Existing listing detail content').count(),
          1
        )
        assert.equal(
          (await geometry(dialog.locator('[class*="_media"]').first())).ratio,
          expanded.ratio
        )
        await dialog
          .getByRole('button', { name: 'Message Seller', exact: true })
          .click()
        assert.deepEqual(await p.evaluate(() => window.auth), [
          'contact-seller',
        ])
        await p.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        await p.evaluate(() => {
          window.viewer = { id: 'fixture-buyer', displayName: 'Buyer' }
          window.show('page')
        })
        await p.locator('[data-slot="expandable-card"]').click()
        dialog = p.getByRole('dialog')
        await dialog.waitFor()
        const offer = dialog.getByRole('button', {
          name: 'Make Offer',
          exact: true,
        })
        await offer.waitFor()
        await p.waitForFunction(
          () =>
            !Array.from(document.querySelectorAll('button')).find(
              (b) => b.textContent.trim() === 'Make Offer'
            )?.disabled
        )
        await dialog.getByRole('button', { name: 'Add to favorites' }).click()
        await dialog
          .getByRole('button', { name: 'Remove from favorites' })
          .waitFor()
        await dialog
          .getByRole('button', { name: 'Message Seller', exact: true })
          .click()
        assert.deepEqual(await p.evaluate(() => window.contacts), [
          { id: 'fixture-listing', contact: true },
        ])
        await offer.click()
        assert.deepEqual(await p.evaluate(() => window.contacts), [
          { id: 'fixture-listing', contact: true },
          { id: 'fixture-listing', contact: false },
        ])
        await p.waitForFunction(() => window.actions.length === 2)
        const destinations = await p.evaluate(() => window.actions)
        assert(
          destinations[0].includes('conversation=existing-listing-conversation')
        )
        assert(destinations[1].includes('&offer=new&offerIntent='))
        await p.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        await p.goBack()
        await trigger.waitFor()
        await p.evaluate(() => window.show('resale'))
        const resaleMedia = await geometry(
          p.locator('[data-slot="expandable-card"] span').first()
        )
        assert.deepEqual(resaleMedia, shopMedia)
        await p.evaluate(() => window.show('empty'))
        await p.getByRole('heading', { name: 'No shops yet' }).waitFor()
        assert.equal(
          await p
            .getByText(
              'Shops will appear here when sellers open their storefronts.'
            )
            .count(),
          1
        )
        assert.equal(await p.locator('[data-market-card]').count(), 0)
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        assert.deepEqual(errors, [])
        assert.equal(network, 0)
        console.log(
          `PASS public Shop ${width} reduced=${reduced}: shared card/expansion/grid, PRO, public view/back, existing favorite/contact/offer, empty, no overflow/network`
        )
        await p.close()
      }
  } finally {
    await browser.close()
    // Remove generated fixture sources/bundle. Only ignored QA screenshots remain.
    for (const file of [
      'shop-session.jsx',
      'shop-auth.jsx',
      'shop-navigation.jsx',
      'shop-link.jsx',
      'shop-messages.jsx',
      'shop-requests.jsx',
      'auth-mock.js',
      'router-mock.js',
      'financial-mock.js',
      'request-mock.js',
      'bundle.js',
      'index.html',
    ])
      fs.rmSync(path.join(root, file), { force: true })
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
