/* global window, document */
// Actual shared owner management + five-step ListingForm; controlled local API only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(root, 'b14-' + Object.keys(aliases).length + '.tsx')
  fs.writeFileSync(file, source)
  aliases[name] = file
  if (name.startsWith('@/')) aliases['./' + path.basename(name)] = file
}
mock(
  '@/components/listings/marketplace-session',
  `export function useMarketplaceSession(){return {seller:{id:'owner',displayName:'Owner'},loading:false,error:''}}`
)
mock(
  '@/hooks/use-message-seller',
  `export function useMessageSeller(){return {contact(){throw Error('Unexpected buyer action')},busy:false}}`
)
mock(
  '@/components/listings/use-listing-offer-context',
  `export function useListingOfferContext(){return {enabled:false}}`
)
mock(
  '@/lib/listings-api',
  `
export async function getMyListings(q){window.reads.push(q.channel);return window.items.filter(x=>x.listingChannel===q.channel)};
export async function createListing(){throw Error('No Resale fallback')};
export async function createShopListing(input,id){window.createCalls.push(id);if(!window.records[id]){window.records[id]={...input,id,listingChannel:'shop',seller:{id:'owner',displayName:'Owner'},status:'available',publishedAt:null,createdAt:'2026-10-19',photoUrls:[]};window.slotFiles[id]={}};if(window.loseCreate){window.loseCreate=false;throw Error('Lost create response')};return window.records[id]};
export async function getCreationListing(id){if(!window.records[id])throw Error('Not found');return window.records[id]};
export async function uploadListingImage(id,file,slot){if(window.failUpload&&slot===2)throw Error('Controlled upload failure');if(window.slotFiles[id][slot])return;window.slotFiles[id][slot]=file.name;window.uploads.push([id,slot])};
export async function finalizeListing(id){window.finalizes.push(id);if(window.failPublish)throw Error('Shop active product limit reached.');const row=window.records[id];row.publishedAt='2026-10-19';window.items=[...window.items.filter(x=>x.id!==id),{...row}];return row};
export async function updateListing(id,patch){const row={...window.records[id],...patch};window.records[id]=row;window.items=window.items.map(x=>x.id===id?row:x);window.updates.push({id,patch});return row};
export async function markListingSold(id){window.sold.push(id);return updateListing(id,{status:'sold'})};
export async function deleteListing(id){window.deletes.push(id);window.items=window.items.filter(x=>x.id!==id);delete window.records[id]};
export async function abandonListing(id){if(window.records[id]?.publishedAt)throw Error('Already published');window.abandons.push(id);delete window.records[id]};
export async function marketplaceRequest(){throw Error('Unexpected API')};
`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{HomeListings}from'@/components/listings/home-listings';
window.process={env:{}};window.items=[];window.records={};window.createCalls=[];window.slotFiles={};window.reads=[];window.finalizes=[];window.uploads=[];window.sold=[];window.deletes=[];window.abandons=[];window.updates=[];
createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}><main style={{padding:20}}><HomeListings page="my-shop" onSelect={()=>{}} onGuardChange={()=>{}}/></main></LazyMotion>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f1fa;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
const photo = (name) => ({
  name,
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mQAAAAASUVORK5CYII=',
    'base64'
  ),
})
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
      for (const width of (process.env.B14_WIDTHS || '390,430,820,1280,1536')
        .split(',')
        .map(Number)) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        p.setDefaultTimeout(12000)
        const errors = []
        p.on('pageerror', (e) => {
          errors.push(e.message)
          console.error('B14 page error:', e.message)
        })
        await p.route(/^https?:/, (r) => r.abort())
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        const region = p.getByRole('region', {
          name: 'Manage Products',
          exact: true,
        })
        await region
          .getByText('No active products yet.', { exact: true })
          .waitFor()
          .catch(async (error) => {
            console.error(await p.locator('body').innerText())
            throw error
          })
        assert.equal(await p.locator('[data-shop-management-demo]').count(), 0)
        const add = region
          .getByRole('button', { name: /^Add Product|^Add$/ })
          .first()
        await add.click()
        let d = p.getByRole('dialog', { name: 'Add Product', exact: true })
        await d.waitFor()
        await d
          .locator('input[type=file]')
          .setInputFiles([photo('one.png'), photo('two.png')])
        const step = async (n) => {
          await p.waitForFunction(
            (n) =>
              document
                .querySelector('[data-multi-step-form]')
                ?.getAttribute('data-multi-step-form') === String(n),
            n
          )
          await p.waitForTimeout(reduced ? 30 : 650)
        }
        const next = async (n) => {
          await d.getByRole('button', { name: 'Continue', exact: true }).click()
          await step(n)
        }
        const select = async (label, option) => {
          await d.getByRole('combobox', { name: label, exact: true }).click()
          await p.getByRole('option', { name: option, exact: true }).click()
        }
        await next(1)
        await d
          .getByRole('textbox', { name: 'Title', exact: true })
          .fill('Shop Camera')
        await d.locator('input[name=price]').fill('30.00')
        await select('Condition', 'Good')
        await select('Category', 'Electronics')
        await select('Subcategory', 'Cameras')
        await next(2)
        await d
          .getByRole('combobox', { name: /Meeting location/ })
          .fill('Library entrance')
        await d
          .getByRole('textbox', { name: 'Description', exact: true })
          .fill('A working camera.')
        await next(3)
        await d.getByRole('radio', { name: /Arrange Payment Directly/ }).check()
        await next(4)
        assert.equal(await p.locator('[data-review-channel="shop"]').count(), 1)
        assert.equal(await p.evaluate(() => window.createCalls.length), 0)
        const publish = () =>
          d
            .getByRole('button', {
              name: /Publish Product|Retry/,
              exact: false,
            })
            .last()
        await p.evaluate(() => (window.loseCreate = true))
        await publish().click()
        await d
          .getByRole('alert')
          .filter({ hasText: 'Lost create response' })
          .waitFor()
        const id = await p.evaluate(() => window.createCalls[0])
        assert.equal(
          await p.evaluate(() => Object.keys(window.records).length),
          1
        )
        await p.evaluate(() => (window.failUpload = true))
        await publish().click()
        await d
          .getByRole('alert')
          .filter({ hasText: /Continue publication/ })
          .waitFor()
        assert.equal(
          await p.evaluate(() => Object.keys(window.records).length),
          1
        )
        await p.evaluate(() => {
          window.failUpload = false
          window.failPublish = true
        })
        await publish().click()
        await d
          .getByRole('alert')
          .filter({ hasText: /active product limit/ })
          .waitFor()
        assert.equal(
          await p.evaluate(
            () => window.uploads.filter((x) => x[1] === 1).length
          ),
          1
        )
        await p.evaluate(() => (window.failPublish = false))
        await publish().click()
        await d.waitFor({ state: 'detached' })
        let card = region
          .locator('[data-shop-management-card]')
          .filter({ hasText: 'Shop Camera' })
        await card.waitFor()
        assert(
          await p.evaluate(
            (id) => window.createCalls.every((x) => x === id),
            id
          )
        )
        assert.equal(
          await p.evaluate(() => Object.keys(window.records).length),
          1
        )
        await card
          .getByRole('button', { name: 'Edit Product', exact: true })
          .click()
        d = p.getByRole('dialog', { name: 'Edit Product', exact: true })
        await d
          .getByRole('textbox', { name: 'Title', exact: true })
          .fill('Edited Camera')
        for (const n of [1, 2, 3]) await next(n)
        await d
          .getByRole('button', { name: /Save Changes|Retry/ })
          .last()
          .click()
        await d.waitFor({ state: 'detached' })
        card = region
          .locator('[data-shop-management-card]')
          .filter({ hasText: 'Edited Camera' })
        await card.waitFor()
        await card.getByRole('button', { name: /Listing actions/ }).click()
        await p
          .getByRole('menuitem', { name: 'Mark as sold', exact: true })
          .click()
        d = p.getByRole('dialog')
        await d
          .getByRole('button', { name: 'Mark as sold', exact: true })
          .click()
        await d.waitFor({ state: 'detached' })
        await region.getByRole('tab', { name: 'Sold', exact: true }).click()
        await region
          .locator('[data-shop-management-card]')
          .filter({ hasText: 'Edited Camera' })
          .waitFor()
        assert.deepEqual(await p.evaluate(() => window.sold), [id])
        await region.getByRole('tab', { name: 'Active', exact: true }).click()
        await add.click()
        d = p.getByRole('dialog', { name: 'Add Product', exact: true })
        await d.locator('input[type=file]').setInputFiles(photo('discard.png'))
        await d
          .getByRole('button', { name: 'Close Add Product', exact: true })
          .click()
        await p
          .getByRole('dialog', { name: 'Discard this listing?', exact: true })
          .getByRole('button', { name: 'Discard', exact: true })
          .click()
        await d.waitFor({ state: 'detached' })
        await add.click()
        d = p.getByRole('dialog', { name: 'Add Product', exact: true })
        assert.equal(
          await d.locator('form').getAttribute('data-photo-count'),
          '0'
        )
        await d
          .getByRole('button', { name: 'Close Add Product', exact: true })
          .click()
        await d.waitFor({ state: 'detached' })
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        assert.deepEqual(errors, [])
        await p.screenshot({
          path: path.join(root, `b14-management-${width}-${reduced}.png`),
          fullPage: true,
        })
        console.log(
          `PASS B14 shared UI ${width} reduced=${reduced}: empty real inventory, five steps, lost-create/same-ID/upload/quota recovery, edit, Shop-only Sold, Discard, no overflow`
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
