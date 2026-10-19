const { readTestPictureJpeg } = require('../scripts/lib/test-pictures.cjs')
// Real shared Create/Edit form with isolated in-memory API callbacks only.
/* global window, document, getComputedStyle, innerWidth */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'request-mock.js'),
  `
export async function marketplaceRequest(){return {seller:{id:'seller',displayName:'Fixture'}}}
export async function updateListing(id,input){window.savedInput=input;return {...window.listing,...input}}
export async function createListing(input){window.savedInput=input;window.createdListing={...input,id:'created',seller:{id:'seller',displayName:'Fixture'},status:'available',publishedAt:null,photoUrls:[]};return window.createdListing}
export async function uploadListingImage(){window.createdListing.photoUrls=['data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'];return window.createdListing}
export async function finalizeListing(){return {...window.createdListing,publishedAt:new Date().toISOString()}}
export async function getCreationListing(){return window.createdListing}
export async function abandonListing(){throw Error('Unexpected abandon')}
`
)
fs.writeFileSync(
  path.join(root, 'fulfillment-mock.js'),
  'export function listingFulfillmentEnabled(){return true}'
)
aliases['@/lib/listing-fulfillment'] = path.join(root, 'fulfillment-mock.js')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {ListingForm} from '@/components/listings/listing-form';import {MarketplaceSessionProvider} from '@/components/listings/marketplace-session';
const root=createRoot(document.getElementById('root'));window.fetch=async()=>({ok:false});window.showForm=v=>{window.savedInput=null;window.listing=v.edit?{id:'listing',title:'Fixture camera',price:8000,currency:'CAD',category:'Electronics',subcategory:'Cameras',condition:'good',pickupArea:'Near campus',preferredFulfillment:v.delivery?'DELIVERY':'ON_CAMPUS',meetingLocation:v.legacy?null:{label:'Front entrance'},estimatedDeliveryFeeCents:v.legacy?undefined:1050,description:'Frozen description',photoUrls:['data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="500"/>')],seller:{id:'seller',displayName:'Fixture'},status:'available',publishedAt:'2026-10-01',expectedImageCount:1}:undefined;flushSync(()=>root.render(<LazyMotion features={domAnimation}><MarketplaceSessionProvider key={JSON.stringify(v)}><ListingForm listing={window.listing} onCancel={()=>{}} onSaved={()=>{}}/></MarketplaceSessionProvider></LazyMotion>))};
`
)
async function run() {
  await build(aliases)
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
      chromium,
    } = require('./artifacts/browser-tools/node_modules/playwright-core'),
    browser = await chromium.launch({
      executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
      headless: true,
    })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: 'reduce',
        }),
        errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.addInitScript(() => (window.process = { env: {} }))
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const choose = async (name, value) => {
        await p.getByRole('combobox', { name, exact: true }).click()
        await p.getByRole('option', { name: value, exact: true }).click()
      }
      for (const edit of [false, true]) {
        await p.evaluate((v) => window.showForm(v), {
          edit,
          legacy: edit,
          delivery: edit,
        })
        const form = p.getByRole('form', {
          name: edit ? 'Edit listing' : 'Create listing',
          exact: true,
        })
        await form.waitFor()
        assert.equal(
          await form
            .getByRole('combobox', { name: 'Place', exact: true })
            .count(),
          0
        )
        assert.equal(
          await p.getByText('Choose 1-6 photos.', { exact: true }).count(),
          0
        )
        const meeting = form.getByLabel('Meeting location', { exact: true })
        assert.equal(await meeting.getAttribute('required'), '')
        assert.equal(await meeting.inputValue(), '')
        const fee = form.getByLabel('Estimated delivery fee (CA$)', {
          exact: true,
        })
        if (!edit) {
          assert.equal(await fee.count(), 0)
          await choose('Payment method', 'Pay independently')
          await choose('Preferred fulfillment', 'Delivery')
        }
        assert.equal(
          await p
            .getByRole('combobox', { name: 'Payment method', exact: true })
            .count(),
          0
        )
        await fee.waitFor()
        assert.equal(await fee.inputValue(), '0.00')
        await fee.fill('10.50')
        await meeting.fill('Outside front entrance')
        await meeting.press('Tab')
        await choose('Preferred fulfillment', 'Meeting')
        assert.equal(await fee.count(), 0)
        await p
          .getByRole('combobox', { name: 'Payment method', exact: true })
          .waitFor()
        assert.equal(await meeting.inputValue(), 'Outside front entrance')
        assert.equal(await meeting.getAttribute('required'), '')
        await choose('Preferred fulfillment', 'Delivery')
        assert.equal(await fee.inputValue(), '10.50')
        const geometry = await form.evaluate((e) => {
          const builder = e.parentElement,
            preview = builder.querySelector('aside'),
            fieldset = e.querySelector('fieldset'),
            fs = getComputedStyle(fieldset),
            bs = getComputedStyle(builder)
          return {
            gap: bs.gap,
            columns: bs.gridTemplateColumns.split(' ').map(parseFloat),
            padding: getComputedStyle(e).padding,
            fieldGap: fs.gap,
            preview: getComputedStyle(preview).display,
            position: getComputedStyle(preview).position,
            labels: [...fieldset.children].map((n) =>
              n.textContent.trim().slice(0, 40)
            ),
            feeInside: e
              .querySelector('[name="estimatedDeliveryFee"]')
              .closest('div')
              .textContent.includes('Preferred fulfillment'),
          }
        })
        assert.equal(geometry.gap, '28px')
        assert.equal(geometry.padding, '20px')
        assert.equal(geometry.fieldGap, '20px')
        assert(geometry.feeInside)
        assert(geometry.labels[0].includes('Listing details'))
        assert(geometry.labels[1].startsWith('Photos'))
        assert(geometry.labels.at(-1).startsWith('Description'))
        if (width >= 1024) {
          assert.equal(geometry.preview, 'block')
          assert.equal(geometry.position, 'sticky')
          assert(
            await form
              .locator('..')
              .locator('aside')
              .getByText('Estimated delivery fee: CA$10.50', { exact: true })
              .isVisible()
          )
          assert(
            Math.abs(
              geometry.columns[0] / geometry.columns[1] - (edit ? 1 : 9 / 11)
            ) < 0.01
          )
        } else {
          assert.equal(geometry.preview, 'none')
          assert.equal(geometry.columns.length, 1)
        }
        if (edit) {
          await form
            .getByRole('button', { name: 'Save changes', exact: true })
            .click()
          await p.waitForFunction(() => window.savedInput !== null)
          assert.equal(
            await p.evaluate(() => window.savedInput.estimatedDeliveryFeeCents),
            1050
          )
          assert.equal(
            await p.evaluate(() => window.savedInput.meetingLocation.label),
            'Outside front entrance'
          )
          assert.equal(
            await p.evaluate(() =>
              Object.hasOwn(window.savedInput, 'pickupArea')
            ),
            false
          )
          await fee.fill('')
          await form
            .getByRole('button', { name: 'Save changes', exact: true })
            .click()
          await p.waitForFunction(
            () => window.savedInput.estimatedDeliveryFeeCents === 0
          )
        } else {
          await form.locator('[name="title"]').fill('New camera')
          await form.locator('[name="price"]').fill('80')
          await choose('Category', 'Electronics')
          await choose('Subcategory', 'Cameras')
          await choose('Condition', 'Good')
          await form.locator('input[type="file"]').setInputFiles({
            name: 'fixture.png',
            mimeType: 'image/png',
            buffer: readTestPictureJpeg('chair'),
          })
          await form
            .getByRole('button', { name: 'Create', exact: true })
            .click()
          await p.waitForFunction(() => window.savedInput !== null)
          assert.equal(
            await p.evaluate(() => window.savedInput.estimatedDeliveryFeeCents),
            1050
          )
          assert.equal(
            await p.evaluate(
              () =>
                Object.hasOwn(window.savedInput, 'pickupArea') &&
                window.savedInput.pickupArea !== undefined
            ),
            false
          )
        }
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
      }
      await p.evaluate(() =>
        window.showForm({ edit: true, delivery: true, legacy: false })
      )
      assert.equal(
        await p
          .getByRole('form', { name: 'Edit listing', exact: true })
          .getByLabel('Estimated delivery fee (CA$)', { exact: true })
          .inputValue(),
        '10.50'
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS ListingForm ' +
          width +
          ': Place absent, required Meeting both modes, Delivery estimate/create/edit payload, Photos/Description order, unchanged columns/gaps/padding/preview/buttons, no overflow'
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
