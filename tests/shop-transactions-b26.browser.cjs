/* global window, document */
// Existing Shop product card controls, locally gated on; no remote services.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
process.env.NEXT_PUBLIC_SHOP_TRANSACTIONS_ENABLED = 'true'
process.env.NEXT_PUBLIC_MESSAGES_ENV = 'staging'
process.env.NEXT_PUBLIC_SUPABASE_URL =
  'https://pcaqxezdfxofysghssyo.supabase.co'
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(root, 'b26-' + Object.keys(aliases).length + '.tsx')
  fs.writeFileSync(file, source)
  aliases[name] = file
}
mock(
  '@/components/listings/marketplace-session',
  `export function useMarketplaceSession(){return {seller:{id:'buyer',displayName:'Buyer'},loading:false,error:''}}`
)
mock(
  '@/lib/favorites-api',
  `export async function favoriteState(){throw Error('Shop product Favorite must remain outside B26-A')};export async function setFavorite(){throw Error('Unexpected Favorite')}`
)
mock(
  '@/lib/record-marketplace-view',
  `export function recordMarketplaceView(){window.views++}`
)
mock(
  '@/components/listings/use-message-seller',
  `export function useMessageSeller(id){return {busy:false,error:'',contact:async()=>{window.contacts.push({id,contactSeller:true});window.navigation.push('/home?section=messages&conversation=conversation')}}}`
)
mock(
  '@/components/listings/use-listing-offer-context',
  `export function useListingOfferContext(id,sellerId,allowed){return {enabled:allowed,label:'Make Offer',open:async()=>{window.contacts.push({id,contactSeller:false});window.navigation.push('/home?section=messages&conversation=conversation&offer=new&offerIntent=1')},busy:false,disabled:false,error:'',reason:''}}`
)
aliases['./marketplace-session'] =
  aliases['@/components/listings/marketplace-session']
aliases['./use-message-seller'] =
  aliases['@/components/listings/use-message-seller']
aliases['./use-listing-offer-context'] =
  aliases['@/components/listings/use-listing-offer-context']
mock(
  '@/lib/listings-api',
  `export async function marketplaceRequest(){return {activeOfferId:null,orderId:null,hasHistory:false,available:true}};export async function getListing(){return window.listing}`
)
mock(
  'next/router',
  `export function useRouter(){return {push:async href=>{window.navigation.push(href);return true}}}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{PublishedListingCard}from'@/components/listings/published-listing-card';
window.contacts=[];window.navigation=[];window.views=0;createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}><main style={{padding:20}}><PublishedListingCard listing={window.listing}/></main></LazyMotion>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f1fa;font-family:Arial}</style><script>window.process={env:{NEXT_PUBLIC_SHOP_TRANSACTIONS_ENABLED:"true",NEXT_PUBLIC_MESSAGES_ENV:"staging",NEXT_PUBLIC_SUPABASE_URL:"https://pcaqxezdfxofysghssyo.supabase.co"}}</script><div id="root"></div><script src="bundle.js"></script>'
)
const listing = {
  id: '26111111-1111-4111-8111-111111111111',
  listingChannel: 'shop',
  title: 'B26 Shop Product',
  description: 'Shared transaction controls',
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
  seller: { id: 'seller', displayName: 'Shop Seller' },
  photoUrls: [],
  createdAt: '2026-10-22',
  updatedAt: '2026-10-22',
  publishedAt: '2026-10-22',
}
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
    const page = await browser.newPage({
      viewport: { width: 820, height: 900 },
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.addInitScript((value) => (window.listing = value), listing)
    await page.route(/^https?:/, (route) => route.abort())
    await page.goto(
      'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
    )
    await page
      .locator('[data-slot="expandable-card"]')
      .waitFor({ timeout: 10000 })
      .catch(async (error) => {
        console.error({ errors, body: await page.locator('body').innerText() })
        throw error
      })
    await page.locator('[data-slot="expandable-card"]').click()
    const dialog = page.getByRole('dialog')
    await dialog.waitFor()
    const message = dialog.getByRole('button', {
      name: 'Message Seller',
      exact: true,
    })
    const offer = dialog.getByRole('button', {
      name: 'Make Offer',
      exact: true,
    })
    await message.waitFor()
    await offer.waitFor()
    assert.equal(
      await dialog.getByRole('button', { name: /favorites/i }).count(),
      0
    )
    await message.click()
    await page.waitForFunction(() => window.contacts.length === 1)
    assert.deepEqual(await page.evaluate(() => window.contacts[0]), {
      id: listing.id,
      contactSeller: true,
    })
    assert.match(
      (await page.evaluate(() => window.navigation[0])) || '',
      /section=messages.*conversation=conversation/
    )
    await offer.click()
    await page.waitForFunction(() => window.contacts.length === 2)
    assert.deepEqual(await page.evaluate(() => window.contacts[1]), {
      id: listing.id,
      contactSeller: false,
    })
    assert.match(
      (await page.evaluate(() => window.navigation[1])) || '',
      /offer=new&offerIntent=/
    )
    assert.deepEqual(errors, [])
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth
      )
    )
    console.log(
      'PASS B26-A browser component: existing Shop Message Seller and Make Offer controls, intent routing, no product Favorite expansion, no overflow'
    )
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
