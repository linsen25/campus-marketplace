/* global window,document,getComputedStyle */
// Management-owned creation, real form/publication pipeline and native modal. Offline only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs'),
  aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(
    root,
    'sheet-mock-' + Object.keys(aliases).length + '.tsx'
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
  `export async function getMyListings(q){window.reads.push(q.channel);return window.items.filter(x=>x.listingChannel===q.channel)};export async function createListing(input){window.creates.push(input);window.item={...input,id:'new-resale',listingChannel:'resale',seller:{id:'owner',displayName:'Fixture'},status:'available',createdAt:'2026-10-17',publishedAt:null,photoUrls:[]};return window.item};export async function uploadListingImage(id,file){window.uploads.push(file.name)};export async function finalizeListing(id){window.item={...window.item,publishedAt:'2026-10-17',photoUrls:[window.photo]};window.items=[window.item,...window.items.filter(x=>x.id!==id)];return window.item};export async function getCreationListing(){return window.item};export async function abandonListing(){throw Error('Unexpected abandonment')};export async function updateListing(){throw Error('Unexpected edit')};export async function deleteListing(){throw Error('Unexpected deletion')};export async function markListingSold(){throw Error('Unexpected sold')};export async function marketplaceRequest(){throw Error('Unexpected API')}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{HomeListings}from'@/components/listings/home-listings';const root=createRoot(document.getElementById('root'));let version=0;const guard=()=>{};function App({initial}){const[page,setPage]=useState(initial);return <LazyMotion features={domAnimation}><div style={{height:360}}/><main style={{padding:24,maxWidth:1200,margin:'auto'}}><h1>{['my-shop','create-shop-listing'].includes(page)?'Manage Products':'Manage Resale'}</h1><HomeListings page={page} onSelect={setPage} onGuardChange={guard}/><div style={{height:700}}/></main></LazyMotion>};window.renderCase=(page='my-listings')=>root.render(<App key={++version} initial={page}/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f8f6fa;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
const photo = {
  name: 'lamp.png',
  mimeType: 'image/png',
  buffer: Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7mQAAAAASUVORK5CYII=',
    'base64'
  ),
}
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
    for (const reduced of process.env.PRESENTATION_WIDTHS
      ? [false]
      : [false, true])
      for (const width of process.env.PRESENTATION_WIDTHS
        ? process.env.PRESENTATION_WIDTHS.split(',').map(Number)
        : [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: {
            width,
            height: Number(process.env.PHOTO_TEST_HEIGHT || 1000),
          },
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
          if (
            u.pathname.startsWith('/static/testPic/') || u.pathname.startsWith('/static/images/') ||
            u.pathname.startsWith('/demo/')
          )
            return r.fulfill({
              path: path.resolve('public', '.' + u.pathname),
              contentType: u.pathname.endsWith('.webp') ? 'image/webp' : 'image/jpeg',
            })
          throw Error('Unexpected ' + u.pathname)
        })
        await p.goto('http://localhost:4177/')
        await p.evaluate(() => {
          window.creates = []
          window.uploads = []
          window.reads = []
          window.photo =
            'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="400"%3E%3Crect width="400" height="400" fill="purple"/%3E%3C/svg%3E'
          window.items = [
            {
              id: 'existing',
              title: 'Existing lamp',
              price: 2000,
              currency: 'CAD',
              status: 'available',
              publishedAt: '2026-10-16',
              createdAt: '2026-10-16',
              listingChannel: 'resale',
              category: 'Home & Dorm',
              subcategory: 'Lighting & Decor',
              condition: 'good',
              description: 'A lamp',
              meetingLocation: { label: 'Library' },
              preferredFulfillment: 'ON_CAMPUS',
              photoUrls: [window.photo],
              seller: { id: 'owner', displayName: 'Fixture' },
            },
          ]
          window.renderCase()
        })
        if (!process.env.ONLY_SHOP) {
          const workspace = p.getByRole('region', {
              name: 'Manage Resale',
              exact: true,
            }),
            create = workspace.getByRole('button', {
              name: width < 1024 ? 'Create' : 'Create Resale',
              exact: true,
            })
          await create.waitFor()
          await p.evaluate(() => window.scrollTo(0, 220))
          const before = await p.evaluate(() => window.scrollY)
          await create.click()
          const sheet = p.getByRole('dialog', {
            name: 'Create Resale',
            exact: true,
          })
          await sheet.waitFor()
          await p.waitForTimeout(200)
          assert.equal(
            await workspace.locator('[data-resale-management-card]').count(),
            1,
            'management remains mounted'
          )
          const box = await sheet.boundingBox()
          assert(
            box.x >= 0 &&
              box.x + box.width <= width + 1 &&
              box.y >= 0 &&
              box.y + box.height <= p.viewportSize().height + 1
          )
          assert.equal(
            await p.evaluate(
              () => getComputedStyle(document.documentElement).overflowY
            ),
            'hidden'
          )
          const wizardCard = sheet.locator('[data-multi-step-form] > div')
          assert.equal(
            await wizardCard.evaluate(
              (n) => getComputedStyle(n).borderTopWidth
            ),
            '0px'
          )
          const scroll = sheet.locator('[data-listing-wizard-scroll]')
          const footer = sheet.locator('footer')
          const initialFooterTop = await footer.evaluate(
            (n) => n.getBoundingClientRect().top
          )
          const upload = await sheet
            .locator('[data-slot="file-drop"]')
            .boundingBox()
          const preview = await sheet
            .locator('[data-selected-photos]')
            .boundingBox()
          if (width >= 768) {
            assert(upload.x + upload.width <= preview.x + 1)
            const group = await sheet
              .locator('[data-resale-photo-upload]')
              .boundingBox()
            const frame = await sheet
              .locator('[data-selected-photos] > div:first-child')
              .boundingBox()
            assert(
              Math.abs(
                group.y + group.height / 2 - frame.y - frame.height / 2
              ) < 1,
              'whole upload group centered with preview frame'
            )
            assert(
              await scroll.evaluate(
                (n) => n.scrollHeight <= n.clientHeight + 1
              ),
              'Photos fits without scroll'
            )
          } else
            assert(
              preview.y >= upload.y + upload.height,
              'mobile Photos stacked'
            )
          assert.equal(
            await sheet.evaluate(
              (n) => getComputedStyle(n, '::backdrop').backgroundColor
            ),
            'rgba(0, 0, 0, 0.6)'
          )
          if (process.env.PHOTOS_LEFT_ONLY) {
            await p.waitForTimeout(500)
            const left = sheet.locator('[data-resale-photo-upload]')
            const right = sheet.locator('[data-selected-photos]')
            const beforeRight = await right.boundingBox()
            const leftStyles = await left.evaluate((n) => ({
              gap: getComputedStyle(n).rowGap,
              padding: getComputedStyle(n).padding,
              align: getComputedStyle(n).alignSelf,
            }))
            const verifyPreview = async () => {
              const result = await left.evaluate((n) => {
                const parent = n.parentElement
                const custom = Array.from(n.classList).find((c) =>
                  c.includes('resalePhotoUpload')
                )
                const alignment = Array.from(parent.classList).find((c) =>
                  c.includes('resalePhotoStep')
                )
                const right = n.nextElementSibling
                const snapshot = () =>
                  [
                    right,
                    right.firstElementChild,
                    right.querySelector('[data-active-photo]'),
                  ].map((el) => {
                    const b = el.getBoundingClientRect(),
                      s = getComputedStyle(el)
                    return {
                      x: b.x,
                      y: b.y,
                      width: b.width,
                      height: b.height,
                      transform: s.transform,
                      border: s.border,
                      radius: s.borderRadius,
                    }
                  })
                const current = snapshot()
                n.classList.remove(custom)
                parent.classList.remove(alignment)
                const previous = snapshot()
                n.classList.add(custom)
                parent.classList.add(alignment)
                return { current, previous }
              })
              assert.deepEqual(
                result.current,
                result.previous,
                'preview geometry/rotation/border unchanged from previous layout'
              )
              if (width >= 768) {
                const group = await left.boundingBox(),
                  frame = await right
                    .locator(':scope > div:first-child')
                    .boundingBox()
                assert(
                  Math.abs(
                    group.y + group.height / 2 - frame.y - frame.height / 2
                  ) < 1,
                  'whole group matches preview layout center'
                )
              }
            }
            await verifyPreview()
            const zone = await left
              .locator('[data-slot="file-drop"] > label')
              .boundingBox()
            const note = await left
              .locator('[data-photo-requirements]')
              .boundingBox()
            const fieldLabel = await left.locator(':scope > span').boundingBox()
            if (width >= 768) {
              assert.equal(leftStyles.gap, '10px')
              assert.equal(leftStyles.padding, '0px')
              assert.equal(leftStyles.align, 'center')
              assert(Math.abs(zone.height - 200) < 1, 'dominant 200px dropzone')
              assert(
                Math.abs(zone.width - (await left.boundingBox()).width) < 1,
                'uses full left column'
              )
              assert(
                Math.abs(note.y - zone.y - zone.height - 10) < 1,
                'helper next to dropzone'
              )
              assert(
                Math.abs(zone.y - fieldLabel.y - fieldLabel.height - 10) < 1,
                'compact label spacing'
              )
            }
            assert.equal(
              await sheet.locator('input[type=file]').getAttribute('accept'),
              'image/jpeg,image/png,image/webp'
            )
            await sheet
              .getByText('Drag files here, or click to browse', { exact: true })
              .waitFor()
            await sheet
              .getByText('image/jpeg, image/png, image/webp', { exact: true })
              .waitFor()
            await sheet
              .getByText('1-6 photos. JPEG, PNG or WebP. Maximum 3 MB each.', {
                exact: true,
              })
              .waitFor()
            assert(
              await scroll.evaluate(
                (n) => n.scrollHeight <= n.clientHeight + 1
              ),
              'no Step 1 scrollbar'
            )
            await p.screenshot({
              path: path.join(root, `resale-photos-left-${width}.png`),
            })
            await sheet.locator('input[type=file]').setInputFiles(photo)
            await sheet
              .getByRole('button', { name: 'Next selected photo', exact: true })
              .waitFor()
            await p.waitForTimeout(600)
            await verifyPreview()
            assert.equal(
              await sheet.locator('form').getAttribute('data-photo-count'),
              '1'
            )
            assert.equal(
              await sheet
                .getByRole('button', {
                  name: 'Next selected photo',
                  exact: true,
                })
                .isDisabled(),
              true
            )
            await sheet
              .getByRole('button', { name: 'Continue', exact: true })
              .click()
            await sheet.locator('[data-multi-step-form="1"]').waitFor()
            assert.equal(
              await p.evaluate(() => window.creates.length),
              0,
              'no early publication'
            )
            assert.deepEqual(errors, [])
            console.log(
              'PASS Resale Photos left-only layout',
              width,
              JSON.stringify({ zone, note, preview: beforeRight })
            )
            await p.close()
            continue
          }
          await p.mouse.click(3, 3)
          assert(await sheet.isVisible(), 'fresh backdrop click is a no-op')
          assert.equal(await p.getByRole('dialog').count(), 1)
          await p.keyboard.press('Tab')
          assert(
            await sheet.evaluate((n) => n.contains(document.activeElement)),
            'focus stays in modal'
          )
          if (!reduced && width >= 1280) {
            await p.screenshot({
              path: path.join(root, 'creation-photos-' + width + '.png'),
            })
            console.log(
              'Photos geometry',
              width,
              await scroll.evaluate((n) => ({
                content: n.scrollHeight,
                viewport: n.clientHeight,
              }))
            )
          }
          await p.mouse.move(3, 3)
          await p.mouse.wheel(0, 700)
          await p.waitForTimeout(120)
          assert.equal(await p.evaluate(() => window.scrollY), before)
          await sheet
            .getByRole('button', { name: 'Close Create Resale', exact: true })
            .click()
          await sheet.waitFor({ state: 'detached' })
          assert.equal(await p.evaluate(() => window.scrollY), before)
          assert(
            await create.evaluate((n) => document.activeElement === n),
            'focus returns to create trigger'
          )
          assert.equal(await p.evaluate(() => window.creates.length), 0)
          await create.click()
          await sheet.waitFor()
          await sheet.locator('input[type=file]').setInputFiles(photo)
          await p.mouse.click(3, 3)
          assert.equal(
            await p.getByRole('dialog').count(),
            1,
            'dirty backdrop click does not even request discard'
          )
          assert.equal(
            await sheet.locator('form').getAttribute('data-photo-count'),
            '1'
          )
          await sheet
            .getByRole('button', { name: 'Close Create Resale', exact: true })
            .click()
          const discard = p.getByRole('dialog', {
            name: 'Discard this listing?',
            exact: true,
          })
          await discard.waitFor()
          await p.mouse.click(3, 3) // Other dialogs retain their default backdrop-close convention.
          await discard.waitFor({ state: 'detached' })
          assert.equal(
            await sheet.locator('form').getAttribute('data-photo-count'),
            '1'
          )
          await sheet
            .getByRole('button', { name: 'Close Create Resale', exact: true })
            .click()
          await discard.waitFor()
          await discard
            .getByRole('button', { name: 'Discard', exact: true })
            .click()
          await sheet.waitFor({ state: 'detached' })
          assert.equal(await p.evaluate(() => window.creates.length), 0)
          await create.click()
          await sheet.waitFor()
          await sheet.locator('input[type=file]').setInputFiles(photo)
          const stepGeometry = []
          const measureStep = async () => {
            const geometry = await scroll.evaluate((node) => ({
              content: node.firstElementChild.getBoundingClientRect().height,
              viewport: node.clientHeight,
              scroll: node.scrollHeight,
            }))
            const modal = await sheet.boundingBox()
            const foot = await footer.boundingBox()
            const horizontal = await sheet
              .locator('[data-multi-step-form]')
              .boundingBox()
            assert(
              Math.abs(
                horizontal.width - modal.width + (width < 640 ? 2 : 18)
              ) < 2,
              'wizard keeps full original column width'
            )
            assert(
              modal.y >= 0 &&
                modal.y + modal.height <= p.viewportSize().height + 1,
              'viewport-safe modal'
            )
            assert(
              foot.y + foot.height <= modal.y + modal.height + 1,
              'footer remains inside modal'
            )
            if (width >= 768) {
              if (modal.height < p.viewportSize().height - 65)
                assert(
                  Math.abs(geometry.viewport - geometry.content) < 2,
                  'natural content height without unused canvas'
                )
              if (geometry.scroll > geometry.viewport + 2)
                assert(
                  Math.abs(modal.height - (p.viewportSize().height - 64)) < 2,
                  'scroll only at viewport cap'
                )
            } else {
              assert(
                Math.abs(modal.height - (p.viewportSize().height - 16)) < 1,
                'mobile height unchanged'
              )
              assert(
                Math.abs(foot.y - initialFooterTop) < 2,
                'mobile footer position unchanged'
              )
            }
            return { ...geometry, height: modal.height }
          }
          await p.waitForTimeout(reduced ? 40 : 600)
          stepGeometry[0] = await measureStep()
          const next = async (n) => {
            const previousHeight = (await sheet.boundingBox()).height
            await p.evaluate(() => {
              window.stepResizeSamples = []
              window.sampleStepResize = true
              window.stepChromeClipped = false
              const tick = () => {
                if (!window.sampleStepResize) return
                const modal = document.querySelector(
                  '[data-listing-creation-sheet="resale"]'
                )
                const box = modal.getBoundingClientRect()
                const footerBox = modal
                  .querySelector('footer')
                  .getBoundingClientRect()
                if (
                  footerBox.bottom > box.bottom + 2 ||
                  footerBox.top < box.top
                )
                  window.stepChromeClipped = true
                window.stepResizeSamples.push(
                  document
                    .querySelector('[data-listing-creation-sheet="resale"]')
                    .getBoundingClientRect().height
                )
                window.requestAnimationFrame(tick)
              }
              window.requestAnimationFrame(tick)
            })
            await sheet
              .getByRole('button', { name: 'Continue', exact: true })
              .click()
            await sheet.locator('[data-multi-step-form="' + n + '"]').waitFor()
            await p.waitForTimeout(reduced ? 40 : 600)
            stepGeometry[n] = await measureStep()
            const samples = await p.evaluate(() => {
              window.sampleStepResize = false
              return window.stepResizeSamples
            })
            assert(
              !(await p.evaluate(() => window.stepChromeClipped)),
              'footer remains inside during resize'
            )
            assert(
              samples.every((h) => h > 200),
              'no zero-height transition flash'
            )
            if (
              width >= 768 &&
              !reduced &&
              Math.abs(previousHeight - stepGeometry[n].height) > 20
            ) {
              const low = Math.min(previousHeight, stepGeometry[n].height)
              const high = Math.max(previousHeight, stepGeometry[n].height)
              assert(
                samples.some((h) => h > low + 3 && h < high - 3),
                'measured height animates through intermediate sizes'
              )
            }
            if (!reduced && width >= 1280) {
              await p.screenshot({
                path: path.join(
                  root,
                  'creation-step-' + n + '-' + width + '.png'
                ),
              })
              console.log(
                'Step geometry',
                width,
                n,
                await scroll.evaluate((node) => ({
                  content: node.scrollHeight,
                  viewport: node.clientHeight,
                }))
              )
            }
          }
          await next(1)
          if (width >= 768)
            assert(
              stepGeometry[1].height < stepGeometry[0].height - 20,
              'Details shrinks below Photos'
            )
          if (width >= 768) {
            const title = await sheet
                .locator('input[name=title]')
                .boundingBox(),
              price = await sheet.locator('input[name=price]').boundingBox()
            assert(title.x + title.width <= price.x + 1)
            assert(Math.abs(title.y - price.y) < 2)
            assert(
              await scroll.evaluate(
                (n) => n.scrollHeight <= n.clientHeight + 1
              ),
              'Details fits without scroll'
            )
          }
          await sheet.locator('input[name=title]').fill('New resale lamp')
          await sheet.locator('input[name=price]').fill('25.00')
          for (const [label, option] of [
            ['Condition', 'Good'],
            ['Category', 'Home & Dorm'],
            ['Subcategory', 'Lighting & Decor'],
          ]) {
            const beforeMenu = await scroll.evaluate((n) => n.scrollHeight)
            const footerTop = await footer.evaluate(
              (n) => n.getBoundingClientRect().top
            )
            const menuHeight = (await sheet.boundingBox()).height
            await sheet
              .getByRole('combobox', { name: label, exact: true })
              .click()
            const menu = sheet.getByRole('listbox', {
              name: label,
              exact: true,
            })
            await menu.waitFor()
            assert(
              Math.abs((await sheet.boundingBox()).height - menuHeight) < 2,
              'popover does not resize modal'
            )
            assert.equal(
              await scroll.evaluate((n) => n.scrollHeight),
              beforeMenu,
              'menu does not grow step'
            )
            assert(
              Math.abs(
                (await footer.evaluate((n) => n.getBoundingClientRect().top)) -
                  footerTop
              ) < 2,
              'menu does not move footer'
            )
            assert(
              await menu.evaluate((n) =>
                n.parentElement.matches(':popover-open')
              ),
              'native top-layer overlay'
            )
            if (label === 'Category') {
              assert(
                await menu.evaluate((n) => n.scrollHeight > n.clientHeight),
                'long list scrolls internally'
              )
              await p.keyboard.press('Escape')
              assert.equal(
                await sheet.getByRole('listbox').count(),
                0,
                'Escape closes select'
              )
              assert.equal(
                await p.getByRole('dialog').count(),
                1,
                'Escape does not close creation dialog'
              )
              await sheet
                .getByRole('combobox', { name: label, exact: true })
                .click()
              await menu.waitFor()
            }
            const mb = await menu.boundingBox()
            assert(
              mb.x >= 0 && mb.x + mb.width <= width + 1,
              'menu stays inside viewport'
            )

            await sheet
              .getByRole('option', { name: option, exact: true })
              .click()
            await p.waitForTimeout(180)
          }
          const titleBox = await sheet
            .locator('input[name=title]')
            .boundingBox()
          await p.mouse.move(titleBox.x + 20, titleBox.y + 15)
          await p.mouse.down()
          await p.mouse.move(3, 3)
          await p.mouse.up()
          assert.equal(
            await p.getByRole('dialog').count(),
            1,
            'drag selection/release outside does not dismiss'
          )
          assert.equal(
            await sheet.locator('input[name=title]').inputValue(),
            'New resale lamp'
          )
          await next(2)
          if (width === 820) {
            await sheet
              .getByRole('combobox', {
                name: 'Preferred fulfillment',
                exact: true,
              })
              .click()
            await sheet
              .getByRole('option', { name: 'Delivery', exact: true })
              .click()
            await p.waitForTimeout(180)
            await sheet.locator('input[name=estimatedDeliveryFee]').fill('4.50')
          }
          if (width >= 768) {
            const fulfillment = await sheet
                .getByRole('combobox', {
                  name: 'Preferred fulfillment',
                  exact: true,
                })
                .boundingBox(),
              description = await sheet
                .getByRole('textbox', { name: 'Description', exact: true })
                .boundingBox()
            assert(fulfillment.x + fulfillment.width <= description.x + 1)
          }
          await sheet
            .getByRole('combobox', { name: /Meeting location/ })
            .fill('Outside library')
          await sheet
            .getByRole('textbox', { name: 'Description', exact: true })
            .fill('Working lamp')
          await next(3)
          const direct = sheet.getByRole('radio', {
            name: /Arrange Payment Directly/,
          })
          if (width === 820) assert(await direct.isDisabled())
          else await direct.check()
          if (width >= 768) {
            const a = await direct.locator('..').boundingBox(),
              b = await sheet
                .getByRole('radio', { name: /^UU Pay/ })
                .locator('..')
                .boundingBox()
            assert(a.x + a.width <= b.x + 1)
          }
          await sheet.getByRole('button', { name: 'Back', exact: true }).click()
          await sheet.locator('[data-multi-step-form="2"]').waitFor()
          await p.waitForTimeout(reduced ? 40 : 600)
          assert.equal(
            await sheet
              .getByRole('textbox', { name: 'Description', exact: true })
              .inputValue(),
            'Working lamp'
          )
          assert.equal(
            await sheet
              .getByRole('combobox', { name: /Meeting location/ })
              .inputValue(),
            'Outside library'
          )
          await next(3)
          if (width !== 820) assert(await direct.isChecked())
          assert.equal(await sheet.locator('[data-review-channel]').count(), 0)
          await next(4)
          await sheet.locator('[data-review-channel="resale"]').waitFor()
          if (width >= 768)
            assert(
              stepGeometry[4].height >=
                Math.min(
                  stepGeometry[3].height + 20,
                  p.viewportSize().height - 64
                ) -
                  1,
              'Review expands beyond Payment'
            )
          console.log(
            'Measured modal heights',
            width,
            p.viewportSize().height,
            reduced,
            stepGeometry.map((g) => Math.round(g.height))
          )
          const footerTop = await footer.evaluate(
            (n) => n.getBoundingClientRect().top
          )
          const reviewOverflows = await scroll.evaluate(
            (n) => n.scrollHeight > n.clientHeight + 1
          )
          await scroll.focus()
          await p.keyboard.press('PageDown')
          await p.waitForTimeout(180)
          assert(
            !reviewOverflows || (await scroll.evaluate((n) => n.scrollTop > 0)),
            'read-only review can be scrolled with keyboard'
          )
          await scroll.evaluate((n) => (n.scrollTop = n.scrollHeight))
          assert(
            Math.abs(
              (await footer.evaluate((n) => n.getBoundingClientRect().top)) -
                footerTop
            ) < 2,
            'footer stays fixed during review scroll'
          )
          const review = sheet.locator('[data-review-channel]')
          assert.equal(await review.locator(':scope > dl').count(), 0)
          assert.equal(
            await review.locator('[data-listing-preview]').count(),
            1
          )
          assert.equal(
            await review
              .getByText('Drag files here / click to browse', { exact: true })
              .count(),
            0
          )
          assert.equal(
            await sheet.locator('[data-wizard-step]').count(),
            1,
            'only active step remains after transition'
          )
          const media = await review
            .locator(
              '[data-listing-preview] > div:first-child > div:first-child'
            )
            .boundingBox()
          const info = await review
            .getByRole('heading', { name: 'New resale lamp', exact: true })
            .boundingBox()
          if (width >= 768)
            assert(info.x >= media.x + media.width, 'horizontal expanded card')
          else assert(info.y >= media.y + media.height, 'stacked expanded card')
          assert.equal(
            await review
              .getByRole('button', { name: /Message Seller|Make Offer/ })
              .count(),
            0
          )
          for (const label of [
            'Seller',
            'Item details',
            'Description',
            'Exchange preferences',
          ])
            assert.equal(
              await review
                .getByRole('heading', { name: label, exact: true })
                .count(),
              1
            )
          if (!reduced)
            await p.screenshot({
              path: path.join(root, 'creation-refined-' + width + '.png'),
            })
          assert.equal(await p.evaluate(() => window.scrollY), before)
          await sheet
            .getByRole('button', { name: 'Confirm & Publish', exact: true })
            .click()
          await sheet.waitFor({ state: 'detached' })
          await workspace
            .getByText('New resale lamp', { exact: true })
            .first()
            .waitFor()
          assert.equal(await p.evaluate(() => window.creates.length), 1)
          assert.equal(
            await p.evaluate(() => window.item.listingChannel),
            'resale'
          )
          assert.deepEqual(await p.evaluate(() => window.uploads), ['lamp.png'])
          assert.equal(await p.evaluate(() => window.scrollY), before)
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
          assert.notEqual(
            await p.evaluate(
              () => getComputedStyle(document.documentElement).overflowY
            ),
            'hidden'
          )
          // Compatibility opens the same management-owned sheet, not a standalone form.
          await p.evaluate(() => window.renderCase('create-listing'))
          await sheet.waitFor()
          await workspace.waitFor()
          await sheet
            .getByRole('button', { name: 'Close Create Resale', exact: true })
            .click()
          await sheet.waitFor({ state: 'detached' })
          await create.waitFor()
          assert.deepEqual(errors, [])
          console.log(
            'PASS Resale creation sheet',
            width,
            reduced ? 'reduced' : 'normal',
            'mounted management; focus/scroll lock+restore; discard safety; wizard; publish+refresh; legacy link'
          )
        }
        const writesBefore = await p.evaluate(() => window.creates.length)
        await p.evaluate(() => {
          window.reads = []
          window.renderCase('my-shop')
        })
        const products = p.getByRole('region', {
          name: 'Manage Products',
          exact: true,
        })
        const add = products.getByRole('button', {
          name: width < 1024 ? 'Add' : 'Add Product',
          exact: true,
        })
        await add.waitFor()
        assert.equal(
          await products
            .getByText('Manage your Shop products and their availability.', {
              exact: true,
            })
            .count(),
          0
        )
        await p.evaluate(() => window.scrollTo(0, 180))
        // Playwright may scroll the trigger into view before its trusted click.
        // Capture the page position after that positioning, before modal locking.
        await add.scrollIntoViewIfNeeded()
        const shopScroll = await p.evaluate(() => window.scrollY)
        await add.click()
        const productSheet = p.getByRole('dialog', {
          name: 'Add Product',
          exact: true,
        })
        await productSheet.waitFor()
        assert.equal(
          await productSheet.getAttribute('data-listing-creation-sheet'),
          'shop'
        )
        await productSheet
          .getByText("Your Shop isn't active yet.", { exact: true })
          .waitFor()
        assert.equal(
          await productSheet.locator('[data-multi-step-form]').count(),
          0
        )
        assert.equal(
          await productSheet.getByText(/UU Resale|Publish Listing/).count(),
          0
        )
        assert.equal(
          await p.evaluate(() => window.creates.length),
          writesBefore
        )
        await p.waitForTimeout(200)
        await p.mouse.click(3, 3)
        assert(await productSheet.isVisible(), 'Shop backdrop also no-op')
        const shopBox = await productSheet.boundingBox()
        assert(
          shopBox.x >= 0 &&
            shopBox.x + shopBox.width <= width + 1 &&
            shopBox.y >= 0 &&
            shopBox.y + shopBox.height <= p.viewportSize().height + 1
        )
        await p.keyboard.press('Escape')
        await productSheet.waitFor({ state: 'detached' })
        assert.equal(await p.evaluate(() => window.scrollY), shopScroll)
        assert(
          (await p.evaluate(() => window.reads)).every(
            (channel) => channel === 'shop'
          )
        )
        await p.evaluate(() => window.renderCase('create-shop-listing'))
        await productSheet.waitFor()
        await products.waitFor()
        await productSheet
          .getByRole('button', { name: 'Close Add Product', exact: true })
          .click()
        await productSheet.waitFor({ state: 'detached' })
        await add.waitFor()
        assert.equal(
          await p.evaluate(() => window.creates.length),
          writesBefore
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        assert.deepEqual(errors, [])
        console.log(
          'PASS Shop creation sheet',
          width,
          reduced ? 'reduced' : 'normal',
          'shared shell; Shop-only query; gate; no Resale fallback; Escape/close; legacy alias'
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
