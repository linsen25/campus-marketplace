/* global window, document */
// Real shared form/publication pipeline with local API fixtures; no hosted writes.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(
    root,
    'wizard-mock-' + Object.keys(aliases).length + '.tsx'
  )
  fs.writeFileSync(file, source)
  aliases[name] = file
  if (name.startsWith('@/')) aliases['./' + path.basename(name)] = file
}
mock(
  '@/components/listings/marketplace-session',
  `const state={seller:{id:'owner',displayName:'Fixture'},loading:false,error:''};export function useMarketplaceSession(){return state}`
)
mock(
  '@/hooks/use-message-seller',
  'export function useMessageSeller(){return {contact(){},busy:false}}'
)
mock(
  '@/components/listings/use-listing-offer-context',
  'export function useListingOfferContext(){return {enabled:false}}'
)
mock(
  '@/lib/listings-api',
  `export async function createListing(input){window.creates.push(input);window.item={...input,id:'created',listingChannel:'resale',seller:{id:'owner',displayName:'Fixture'},status:'available',publishedAt:null,createdAt:'2026-10-17',photoUrls:[]};return window.item};export async function uploadListingImage(id,file){window.uploads.push([id,file.name]);};export async function finalizeListing(id){window.finalizes.push(id);if(window.failPublish)throw Error('Fixture failure');window.item={...window.item,publishedAt:'2026-10-17'};return window.item};export async function getCreationListing(){return window.item};export async function abandonListing(){throw Error('Unexpected abandonment')};export async function updateListing(id,patch){window.editPatch=patch;return {...window.editOriginal,...patch,id}};export async function marketplaceRequest(){throw Error('Unexpected API')}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{ListingForm}from'@/components/listings/listing-form';const root=createRoot(document.getElementById('root'));window.renderCase=(mode='resale',previewOnly=false,listing=undefined)=>root.render(<LazyMotion features={domAnimation}><main style={{padding:24}}><ListingForm key={mode+previewOnly+listing?.id} listing={listing} mode={mode} previewOnly={previewOnly} onSaved={()=>{}}/></main></LazyMotion>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f1fa;font-family:Arial}</style><script>window.process={env:{}};window.creates=[];window.uploads=[];window.finalizes=[]</script><div id="root"></div><script src="bundle.js"></script>'
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
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const reduced of [false, true])
      for (const width of process.env.WIZARD_SHOP_ONLY
        ? []
        : [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        p.setDefaultTimeout(12000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const u = new URL(r.request().url())
          assert.equal(u.origin, 'http://localhost:4177')
          if (u.pathname === '/')
            return r.fulfill({
              path: path.join(root, 'index.html'),
              contentType: 'text/html',
            })
          if (u.pathname === '/bundle.js')
            return r.fulfill({
              path: path.join(root, 'bundle.js'),
              contentType: 'application/javascript',
            })
          if (u.pathname === '/api/places/autocomplete')
            return r.fulfill({ json: { suggestions: [] } })
          throw Error('Unexpected request ' + u.pathname)
        })
        await p.goto('http://localhost:4177/')
        await p.evaluate(() => window.renderCase())
        const wizard = p.locator('[data-multi-step-form]')
        const step = async (n) => {
          await p.waitForFunction(
            (n) =>
              document
                .querySelector('[data-multi-step-form]')
                ?.getAttribute('data-multi-step-form') === String(n),
            n
          )
          await p.waitForTimeout(reduced ? 30 : 650)
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            ),
            'no horizontal overflow'
          )
        }
        const next = async (n) => {
          await p.getByRole('button', { name: 'Continue', exact: true }).click()
          await step(n)
        }
        const back = async (n) => {
          await p.getByRole('button', { name: 'Back', exact: true }).click()
          await step(n)
        }
        const select = async (label, option) => {
          await p.getByRole('combobox', { name: label, exact: true }).click()
          await p.getByRole('option', { name: option, exact: true }).click()
          await p.waitForTimeout(180)
        }
        await step(0)
        assert(
          await p
            .getByRole('button', { name: 'Back', exact: true })
            .isDisabled()
        )
        await p.getByRole('button', { name: 'Continue', exact: true }).click()
        await p
          .getByRole('alert')
          .filter({ hasText: 'Choose 1-6 photos.' })
          .waitFor()
        assert.equal(await wizard.getAttribute('data-multi-step-form'), '0')
        await p.locator('input[type=file]').setInputFiles({
          name: 'bad.txt',
          mimeType: 'text/plain',
          buffer: Buffer.from('bad'),
        })
        await p
          .getByRole('alert')
          .filter({ hasText: /JPEG|PNG|WebP/ })
          .first()
          .waitFor()
        await p.locator('input[type=file]').setInputFiles({
          name: 'large.png',
          mimeType: 'image/png',
          buffer: Buffer.alloc(3 * 1024 * 1024 + 1),
        })
        await p.getByRole('alert').filter({ hasText: /3 MB/ }).first().waitFor()
        await p
          .locator('input[type=file]')
          .setInputFiles([photo('first.png'), photo('second.png')])
        assert.equal(
          await p.locator('form').getAttribute('data-photo-count'),
          '2'
        )
        await next(1)
        await p.getByRole('button', { name: 'Continue', exact: true }).click()
        await p.getByRole('alert').waitFor()
        assert.equal(await wizard.getAttribute('data-multi-step-form'), '1')
        await p
          .getByRole('textbox', { name: 'Title', exact: true })
          .fill('Desk lamp')
        await p.locator('input[name=price]').fill('25.00')
        await select('Condition', 'Good')
        await select('Category', 'Home & Dorm')
        await p.getByRole('button', { name: 'Continue', exact: true }).click()
        await p
          .getByRole('alert')
          .filter({ hasText: 'Choose a marketplace subcategory.' })
          .waitFor()
        assert.equal(
          await wizard.getAttribute('data-multi-step-form'),
          '1',
          'Subcategory remains required'
        )
        await select('Subcategory', 'Lighting & Decor')
        await back(0)
        assert.equal(
          await p.locator('form').getAttribute('data-photo-count'),
          '2'
        )
        await next(1)
        assert.equal(
          await p
            .getByRole('textbox', { name: 'Title', exact: true })
            .inputValue(),
          'Desk lamp'
        )
        await next(2)
        // Delivery still has a visible required location, exactly as current API requires.
        const delivery = width === 820
        if (delivery) await select('Preferred fulfillment', 'Delivery')
        await p.getByRole('button', { name: 'Continue', exact: true }).click()
        await p.getByRole('alert').waitFor()
        assert.equal(await wizard.getAttribute('data-multi-step-form'), '2')
        await p
          .getByRole('combobox', { name: /Meeting location/ })
          .fill('Outside library front entrance')
        await p
          .getByRole('textbox', { name: 'Description', exact: true })
          .fill('A working lamp in good condition.')
        if (delivery)
          await p
            .getByRole('textbox', {
              name: 'Estimated delivery fee (CA$)',
              exact: true,
            })
            .fill('4.50')
        await next(3)
        const direct = p.getByRole('radio', {
          name: /Arrange Payment Directly/,
        })
        if (delivery) assert(await direct.isDisabled())
        else await direct.check()
        await back(2)
        assert.equal(
          await p
            .getByRole('textbox', { name: 'Description', exact: true })
            .inputValue(),
          'A working lamp in good condition.'
        )
        assert.equal(
          await p
            .getByRole('combobox', { name: /Meeting location/ })
            .inputValue(),
          'Outside library front entrance'
        )
        await next(3)
        assert(
          await p
            .getByRole('radio', {
              name: delivery ? /^UU Pay/ : /Arrange Payment Directly/,
            })
            .isChecked()
        )
        assert.equal(await p.locator('[data-listing-preview]').count(), 0)
        await next(4)
        await p.locator('[data-review-channel="resale"]').waitFor()
        assert.equal(await p.locator('aside').count(), 0)
        assert(
          await p
            .getByRole('button', { name: 'Confirm & Publish', exact: true })
            .isEnabled()
        )
        assert.equal(
          await p.evaluate(() => window.creates.length),
          0,
          'no API writes before final publish'
        )
        if (width === 390 && !reduced)
          await p.evaluate(() => (window.failPublish = true))
        await p
          .getByRole('button', { name: 'Confirm & Publish', exact: true })
          .click()
        if (width === 390 && !reduced) {
          await p
            .getByRole('alert')
            .filter({ hasText: /Continue publication/ })
            .waitFor()
          await p.evaluate(() => (window.failPublish = false))
          await p
            .getByRole('button', { name: /Retry|Confirm & Publish/ })
            .last()
            .click()
        }
        await p.waitForFunction(() => Boolean(window.item?.publishedAt))
        assert.equal(await p.evaluate(() => window.creates.length), 1)
        assert.deepEqual(
          await p.evaluate(() => window.uploads.map((x) => x[1])),
          ['first.png', 'second.png']
        )
        const input = await p.evaluate(() => window.creates[0])
        assert.equal(
          input.meetingLocation.label,
          'Outside library front entrance'
        )
        assert.equal(
          input.preferredPaymentMode,
          delivery ? 'uu_pay' : 'external'
        )
        assert.equal(input.expectedImageCount, 2)
        assert(!('listingChannel' in input), 'no client channel override')
        assert.deepEqual(errors, [])
        console.log(
          'PASS wizard',
          width,
          reduced ? 'reduced' : 'normal',
          delivery ? 'Delivery' : 'Meeting',
          width === 390 && !reduced ? 'same-ID retry' : 'publish'
        )
        await p.close()
      }
    const p = await browser.newPage({ viewport: { width: 390, height: 1000 } })
    await p.route('**/*', (r) =>
      r.fulfill({
        path: path.join(
          root,
          r.request().url().endsWith('bundle.js') ? 'bundle.js' : 'index.html'
        ),
        contentType: r.request().url().endsWith('bundle.js')
          ? 'application/javascript'
          : 'text/html',
      })
    )
    await p.goto('http://localhost:4177/')
    await p.evaluate(() => window.renderCase('shop'))
    await p.getByText("Your Shop isn't active yet.", { exact: true }).waitFor()
    assert.equal(await p.locator('[data-multi-step-form]').count(), 0)
    assert.equal(await p.evaluate(() => window.creates.length), 0)
    await p.close()
    console.log('PASS Add Product runtime remains fail-closed')
    const edit = await browser.newPage({
      viewport: { width: 1280, height: 1000 },
    })
    await edit.route('**/*', (r) =>
      r.fulfill({
        path: path.join(
          root,
          r.request().url().endsWith('bundle.js') ? 'bundle.js' : 'index.html'
        ),
        contentType: r.request().url().endsWith('bundle.js')
          ? 'application/javascript'
          : 'text/html',
      })
    )
    await edit.goto('http://localhost:4177/')
    await edit.evaluate(() => {
      window.editOriginal = {
        id: 'existing',
        listingChannel: 'resale',
        title: 'Existing lamp',
        price: 2500,
        currency: 'CAD',
        description: 'Existing description',
        category: 'Home & Dorm',
        subcategory: 'Lighting & Decor',
        condition: 'good',
        status: 'available',
        publishedAt: '2026-10-16',
        createdAt: '2026-10-16',
        seller: { id: 'owner', displayName: 'Fixture' },
        preferredFulfillment: 'ON_CAMPUS',
        preferredPaymentMode: 'uu_pay',
        meetingLocation: { label: 'Library entrance' },
        expectedImageCount: 1,
        photoUrls: [
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mQAAAAASUVORK5CYII=',
        ],
      }
      window.renderCase('resale', false, window.editOriginal)
    })
    const editForm = edit.getByRole('form', {
      name: 'Edit listing',
      exact: true,
    })
    assert.equal(
      await editForm.locator('input[name=title]').inputValue(),
      'Existing lamp'
    )
    assert.equal(
      await editForm.locator('input[name=price]').inputValue(),
      '25.00'
    )
    assert.equal(await edit.locator('[data-multi-step-form]').count(), 0)
    await editForm.locator('input[name=title]').fill('Updated lamp')
    await editForm
      .getByRole('button', { name: 'Save changes', exact: true })
      .click()
    await edit.waitForFunction(() => Boolean(window.editPatch))
    assert.equal(
      await edit.evaluate(() => window.editPatch.title),
      'Updated lamp'
    )
    assert.equal(await edit.evaluate(() => window.editPatch.price), 2500)
    assert.equal(
      await edit.evaluate(() => window.editPatch.description),
      'Existing description'
    )
    await edit.close()
    console.log('PASS existing editor values and partial save preserved')

    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: 'reduce',
      })
      await page.route('**/*', (r) => {
        const u = new URL(r.request().url())
        assert.equal(u.origin, 'http://localhost:4177')
        if (u.pathname === '/api/places/autocomplete')
          return r.fulfill({ json: { suggestions: [] } })
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
      await page.goto('http://localhost:4177/')
      await page.evaluate(() => window.renderCase('shop', true))
      const advance = async (n) => {
        await page
          .getByRole('button', { name: 'Continue', exact: true })
          .click()
        await page.waitForFunction(
          (n) =>
            document
              .querySelector('[data-multi-step-form]')
              ?.getAttribute('data-multi-step-form') === String(n),
          n
        )
        await page.waitForTimeout(30)
      }
      if (width === 390) {
        await page
          .locator('input[type=file]')
          .setInputFiles(Array.from({ length: 7 }, (_, i) => photo(i + '.png')))
        await page
          .getByRole('alert')
          .filter({ hasText: 'Choose at most 6 photos.' })
          .waitFor()
        assert.equal(
          await page.locator('form').getAttribute('data-photo-count'),
          '0'
        )
      }
      await page.locator('input[type=file]').setInputFiles(photo('product.png'))
      await advance(1)
      await page
        .getByRole('heading', { name: 'Product Details', exact: true })
        .waitFor()
      await page.locator('input[name=title]').fill('Shop lamp')
      await page.locator('input[name=price]').fill('25.00')
      for (const [label, option] of [
        ['Condition', 'Good'],
        ['Category', 'Home & Dorm'],
        ['Subcategory', 'Lighting & Decor'],
      ]) {
        await page.getByRole('combobox', { name: label, exact: true }).click()
        await page.getByRole('option', { name: option, exact: true }).click()
        await page.waitForTimeout(180)
      }
      await advance(2)
      await page
        .getByRole('combobox', { name: /Meeting location/ })
        .fill('Library entrance')
      await advance(3)
      assert.equal(await page.getByText(/UU Resale service fee/).count(), 0)
      await advance(4)
      await page.locator('[data-review-channel="shop"]').waitFor()
      await page
        .getByRole('heading', { name: 'Shop lamp', exact: true })
        .waitFor()
      assert(
        await page
          .getByRole('button', { name: 'Publish Product', exact: true })
          .isDisabled()
      )
      assert.equal(
        await page.evaluate(() => window.creates.length),
        0,
        'Shop presentation cannot publish Resale'
      )
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      if (width === 390)
        await page.screenshot({
          path: path.join(root, 'wizard-shop-review.png'),
          fullPage: true,
        })
      console.log(
        'PASS shared Shop preview/context, publication blocked',
        width
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
