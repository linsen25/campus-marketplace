/* global window, document */
// Actual shared owner management + five-step ListingForm; controlled local API only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(root, 'b18-' + Object.keys(aliases).length + '.tsx')
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
export async function marketplaceRequest(url,method,body){return window.fixtureRequest(url,method,body)};
`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{HomeListings}from'@/components/listings/home-listings';
window.process={env:{}};window.items=[{id:'18111111-1111-4111-8111-111111111111',listingChannel:'shop',title:'Local cost product',description:'Local qualification only',price:1000,currency:'CAD',category:'Electronics',subcategory:'Cameras',condition:'good',photoUrls:[],seller:{id:'owner',displayName:'Owner'},status:'available',publishedAt:'2026-10-19',createdAt:'2026-10-19',updatedAt:'2026-10-19'}];window.records={};window.createCalls=[];window.slotFiles={};window.reads=[];window.finalizes=[];window.uploads=[];window.sold=[];window.deletes=[];window.abandons=[];window.updates=[];
createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}><main style={{padding:20}}><HomeListings page="my-shop" onSelect={()=>{}} onGuardChange={()=>{}}/></main></LazyMotion>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f1fa;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
async function fixture() {
  window.cost = {
    listingId: '18111111-1111-4111-8111-111111111111',
    shopId: '18222222-2222-4222-8222-222222222222',
    amountCents: null,
    currency: 'CAD',
    revision: 0,
    updatedAt: null,
  }
  window.expenses = {}
  window.privateCalls = []
  window.failNext = ''
  window.loseNext = false
  window.delayNext = false
  window.fixtureRequest = async (url, method, body) => {
    window.privateCalls.push({ url, method, body })
    if (window.delayNext) {
      window.delayNext = false
      await new Promise((r) => setTimeout(r, 500))
    }
    if (window.failNext) {
      const e = window.failNext
      window.failNext = ''
      throw Error(e)
    }
    if (url.startsWith('/api/shop/costs')) {
      if (method === 'GET') return { ...window.cost }
      if (body.revision !== window.cost.revision)
        throw Error('This record changed. Reload before saving again.')
      window.cost = { ...window.cost, ...body, revision: body.revision + 1 }
      return { ...window.cost }
    }
    if (url === '/api/shop/expenses' && method === 'GET')
      return {
        shopId: window.cost.shopId,
        expenses: Object.values(window.expenses).filter((x) => !x.deletedAt),
        nextCursor: null,
      }
    if (method === 'POST') {
      const old = window.expenses[body.id]
      if (!old)
        window.expenses[body.id] = {
          ...body,
          shopId: window.cost.shopId,
          revision: 1,
          createdAt: '2026-10-19',
          updatedAt: '2026-10-19',
          deletedAt: null,
        }
      if (window.loseNext) {
        window.loseNext = false
        throw Error('Controlled lost response. Please retry.')
      }
      return { ...window.expenses[body.id] }
    }
    const old = window.expenses[body.id]
    if (body.revision !== old.revision)
      throw Error('This record changed. Reload before saving again.')
    window.expenses[body.id] = {
      ...old,
      ...body,
      revision: old.revision + 1,
      deletedAt: method === 'DELETE' ? '2026-10-19' : null,
    }
    return { ...window.expenses[body.id] }
  }
}
async function main() {
  await build(aliases)
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
          viewport: { width, height: 1000 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        p.setDefaultTimeout(12000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => r.abort())
        await p.addInitScript(fixture)
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        const product = p.getByRole('article', {
          name: 'Local cost product',
          exact: true,
        })
        await product.waitFor()
        const openCost = async () => {
          await product
            .getByRole('button', {
              name: 'Listing actions for Local cost product',
              exact: true,
            })
            .click()
          await p
            .getByRole('menuitem', { name: 'Product cost', exact: true })
            .click()
          const d = p.getByRole('dialog', { name: 'Product cost', exact: true })
          await d.waitFor()
          await d.getByRole('button', { name: 'Save', exact: true }).waitFor()
          await p.waitForFunction(
            () =>
              !document.querySelector('[aria-label="Product cost"] input')
                ?.disabled
          )
          return d
        }
        let d = await openCost()
        const input = () =>
          d.getByRole('textbox', { name: 'Product cost (CAD)', exact: true })
        assert.equal(await input().inputValue(), '')
        await input().fill('0')
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d.waitFor({ state: 'detached' })
        assert.equal(await p.evaluate(() => window.cost.amountCents), 0)
        d = await openCost()
        assert.equal(await input().inputValue(), '0.00')
        await input().fill('1.234')
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d.getByRole('alert').waitFor()
        await input().fill('12.34')
        await p.evaluate(() => {
          window.failNext = 'Controlled save failure'
        })
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d.getByText('Controlled save failure', { exact: true }).waitFor()
        assert.equal(await input().inputValue(), '12.34')
        await p.evaluate(() => {
          window.cost.revision++
        })
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d
          .getByText('This record changed. Reload before saving again.', {
            exact: true,
          })
          .waitFor()
        await d.getByRole('button', { name: 'Reload', exact: true }).click()
        await p.waitForFunction(
          () =>
            document.querySelector('[aria-label="Product cost"] input')
              ?.value === '0.00'
        )
        await input().fill('')
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d.waitFor({ state: 'detached' })
        assert.equal(await p.evaluate(() => window.cost.amountCents), null)
        await p.getByRole('button', { name: 'Expenses', exact: true }).click()
        let list = p.getByRole('dialog', { name: 'Shop expenses', exact: true })
        await list.getByText('No expenses yet.', { exact: true }).waitFor()
        await list
          .getByRole('button', { name: 'Add expense', exact: true })
          .click()
        d = p.getByRole('dialog', { name: 'Add expense', exact: true })
        await d
          .getByRole('textbox', { name: 'Amount (CAD)', exact: true })
          .fill('0')
        await d
          .getByRole('button', { name: 'Add expense', exact: true })
          .click()
        await d.getByRole('alert').waitFor()
        await d
          .getByRole('textbox', { name: 'Amount (CAD)', exact: true })
          .fill('12.34')
        await d
          .getByRole('textbox', { name: 'Description (optional)', exact: true })
          .fill('Local private expense')
        await d
          .getByRole('button', { name: 'Expense Type', exact: true })
          .click()
        await p.getByRole('button', { name: 'Marketing', exact: true }).click()
        await p.evaluate(() => {
          window.loseNext = true
          window.delayNext = true
        })
        await d
          .getByRole('button', { name: 'Add expense', exact: true })
          .click()
        assert.equal(
          await d
            .getByRole('button', { name: 'Add expense', exact: true })
            .isDisabled(),
          true
        )
        await d
          .getByText('Controlled lost response. Please retry.', { exact: true })
          .waitFor()
        await d
          .getByRole('button', { name: 'Add expense', exact: true })
          .click()
        await d.waitFor({ state: 'detached' })
        await list.getByText('Local private expense', { exact: true }).waitFor()
        assert.equal(
          await p.evaluate(() => Object.keys(window.expenses).length),
          1
        )
        assert.equal(
          await p.evaluate(
            () =>
              new Set(
                window.privateCalls
                  .filter((x) => x.method === 'POST')
                  .map((x) => x.body.id)
              ).size
          ),
          1
        )
        await list.getByRole('button', { name: 'Edit', exact: true }).click()
        d = p.getByRole('dialog', { name: 'Edit expense', exact: true })
        await d
          .getByRole('textbox', { name: 'Amount (CAD)', exact: true })
          .fill('20.50')
        await d.getByRole('button', { name: 'Save', exact: true }).click()
        await d.waitFor({ state: 'detached' })
        await list.getByText(/CA\$20.50/).waitFor()
        await list
          .getByRole('button', { name: 'Close Expenses', exact: true })
          .click()
        await list.waitFor({ state: 'detached' })
        await p.getByRole('button', { name: 'Expenses', exact: true }).click()
        list = p.getByRole('dialog', { name: 'Shop expenses', exact: true })
        await list.getByText('Local private expense', { exact: true }).waitFor()
        await p.screenshot({
          path: path.join(root, `b18-saved-expense-${width}-${reduced}.png`),
          fullPage: true,
        })
        await list.getByRole('button', { name: 'Delete', exact: true }).click()
        d = p.getByRole('dialog', { name: 'Delete this expense?', exact: true })
        await d.getByRole('button', { name: 'Delete', exact: true }).click()
        await d.waitFor({ state: 'detached' })
        await list.getByText('No expenses yet.', { exact: true }).waitFor()
        assert.equal(
          await p.evaluate(
            () =>
              Object.values(window.expenses).filter((x) => x.deletedAt).length
          ),
          1
        )
        await p.evaluate(() => {
          window.failNext = 'Controlled list failure'
        })
        await list.getByRole('button', { name: 'Reload', exact: true }).click()
        await list
          .getByText('Controlled list failure', { exact: true })
          .waitFor()
        await list.getByRole('button', { name: 'Reload', exact: true }).click()
        await list.getByText('No expenses yet.', { exact: true }).waitFor()
        await p.screenshot({
          path: path.join(root, `b18-expenses-${width}-${reduced}.png`),
          fullPage: true,
        })
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        await p.keyboard.press('Escape')
        await list.waitFor({ state: 'detached' })
        assert.equal(
          await p
            .getByRole('button', { name: 'Expenses', exact: true })
            .evaluate((e) => e === document.activeElement),
          true
        )
        assert.deepEqual(errors, [])
        await p.close()
        console.log(
          `PASS B18 browser ${width} reduced=${reduced}: actual Manage Products cost/expense dialogs, null/zero, failure/conflict/reload, same-ID lost-response retry, edit, retained soft-delete, focus/Escape and no overflow; controlled local transport only`
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
