/* global window, document, getComputedStyle */
// Actual owner workspace, editor, confirmation, Profile overview; local fixtures only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(
    root,
    'resale-mock-' + Object.keys(aliases).length + '.tsx'
  )
  fs.writeFileSync(file, source)
  aliases[name] = file
  if (name.startsWith('@/')) aliases['./' + path.basename(name)] = file
}
mock(
  '@/lib/listings-api',
  `export async function marketplaceRequest(url){if(url==='/api/profile/account')return {username:'Fixture',email:'fixture@uwo.ca',emailVerified:true,createdAt:'2026-01-01'};throw Error('Unexpected API '+url)};export async function getMyListings(){return window.items};export async function deleteListing(id){window.deletes.push(id);window.items=window.items.filter(x=>x.id!==id)};export async function markListingSold(){throw Error('Mark sold must not be reachable')};export async function abandonListing(){};export async function createListing(){window.creates.push('unexpected');throw Error('Unexpected create')};export async function updateListing(id,patch){window.edits.push(id);window.editPatches.push(patch);if(window.failEdit)throw Error('Fixture update failed');const saved={...window.items.find(x=>x.id===id),...patch};window.items=window.items.map(x=>x.id===id?saved:x);return saved}`
)
mock(
  '@/components/listings/marketplace-session',
  `const state={seller:{id:'owner',displayName:'Fixture'},loading:false,error:''};export function useMarketplaceSession(){return state}`
)
mock(
  '@/components/home/financial-settings',
  'export function FinancialSettings(){return <section aria-label="Payments & payouts">Payments & payouts</section>}'
)
mock(
  '@/components/home/profile-avatar',
  'export function ProfileAvatar(){return <span>Avatar</span>};export function AvatarDialog(){return null}'
)
mock(
  '@/components/shops/shop-settings',
  'export function ShopSettings(){return null}'
)
mock(
  '@/components/notifications/notification-settings',
  'export function NotificationSettings(){return null}'
)
mock(
  '@/components/home/profile-analytics',
  'export function ProfileAnalytics(){return <section aria-label="Account analytics"><h3>Your Activity</h3><h3>Marketplace Trends</h3></section>}'
)
mock(
  '@/hooks/use-message-seller',
  'export function useMessageSeller(){return {contact(){},busy:false}}'
)
mock(
  '@/components/listings/use-listing-offer-context',
  'export function useListingOfferContext(){return {enabled:false}}'
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState,useRef}from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{HomeListings}from'@/components/listings/home-listings';import{ProfileOverview}from'@/components/home/profile-overview';import{AccountAnalysis}from'@/components/home/account-analysis';const root=createRoot(document.getElementById('root'));function App({profile}){const[page,setPage]=useState('my-listings');const history=useRef({activity:0,marketplace:0});return <LazyMotion features={domAnimation}><main style={{padding:24,maxWidth:1200,margin:'auto'}}>{profile?<><ProfileOverview/><AccountAnalysis replayToken={1} replayHistory={history}/></>:<><h1>Manage Resale</h1><HomeListings page={page} onSelect={setPage} onGuardChange={()=>{}}/></>}</main></LazyMotion>};window.renderCase=(profile)=>root.render(<App key={String(profile)} profile={profile}/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f1fa;font-family:Arial}h1{font-size:24px;margin-bottom:16px}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
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
    for (const width of process.env.EDIT_TEST_WIDTHS
      ? process.env.EDIT_TEST_WIDTHS.split(',').map(Number)
      : [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({
        viewport: {
          width,
          height: Number(process.env.EDIT_TEST_HEIGHT || 1000),
        },
      })
      p.setDefaultTimeout(10000)
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route('**/*', (r) => {
        const u = new URL(r.request().url())
        if (u.origin !== 'http://localhost:4177')
          throw Error('Unexpected network')
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
        throw Error('Unexpected request ' + u.pathname)
      })
      await p.goto('http://localhost:4177/')
      await p.evaluate(() => {
        window.deletes = []
        window.edits = []
        window.editPatches = []
        window.creates = []
        window.actions = []
        window.items = [
          {
            id: 'lamp',
            title: 'Desk Lamp',
            price: 2500,
            status: 'available',
            createdAt: '2026-10-15',
            category: 'Home & Dorm',
            subcategory: 'Lighting & Decor',
          },
          {
            id: 'chair',
            title: 'Accent Chair',
            price: 4500,
            status: 'available',
            createdAt: '2026-10-16',
            category: 'Home & Dorm',
            subcategory: 'Furniture',
          },
          {
            id: 'sold',
            title: 'Sold Book',
            price: 1000,
            status: 'sold',
            createdAt: '2026-10-14',
            category: 'Textbooks & School',
            subcategory: 'Textbooks',
          },
        ].map((x) => ({
          ...x,
          publishedAt: '2026-10-14',
          listingChannel: 'resale',
          seller: { id: 'owner', displayName: 'Fixture' },
          condition: 'good',
          description: 'Fixture listing description.',
          pickupArea: 'ON_CAMPUS',
          preferredFulfillment: 'ON_CAMPUS',
          meetingLocation: { label: 'Campus' },
          photoUrls: [
            'data:image/svg+xml,' +
              encodeURIComponent(
                '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400" fill="purple"/></svg>'
              ),
          ],
        }))
        window.renderCase(true)
      })
      await p.getByText('Your Activity', { exact: true }).waitFor()
      await p.getByText('Marketplace Trends', { exact: true }).waitFor()
      await p
        .getByRole('region', { name: 'Payments & payouts', exact: true })
        .waitFor()
      assert.equal(await p.locator('[data-shop-surface]').count(), 0)
      assert.equal(
        await p
          .getByText(
            /Your Shop isn't active yet|Create your own storefront|Shop Analysis/
          )
          .count(),
        0
      )
      assert.equal(await p.locator('[data-shop-pro-badge]').count(), 0)
      await p.evaluate(() => window.renderCase(false))
      const workspace = p.getByRole('region', {
          name: 'Manage Resale',
          exact: true,
        }),
        cards = workspace.locator('[data-resale-management-card]')
      await cards.first().waitFor()
      assert.equal(await cards.count(), 2)
      assert.equal(
        await workspace
          .getByRole('button', {
            name: width < 1024 ? 'Create' : 'Create Resale',
            exact: true,
          })
          .count(),
        1
      )
      assert.equal(await workspace.getByText(/Mark as sold/i).count(), 0)
      assert.equal(
        await workspace
          .getByText('Manage your listings and their availability.', {
            exact: true,
          })
          .count(),
        0
      )
      const titles = () => cards.locator('[class*="_title"]').allTextContents()
      assert.deepEqual(await titles(), ['Accent Chair', 'Desk Lamp'])
      await workspace.getByRole('tab', { name: 'Sold', exact: true }).click()
      await p.waitForTimeout(250)
      assert.equal(await cards.count(), 1)
      await cards.first().getByText('Sold', { exact: true }).waitFor()
      assert(
        await cards
          .first()
          .getByRole('button', { name: 'Edit listing', exact: true })
          .isDisabled()
      )
      await workspace.getByRole('tab', { name: 'Active', exact: true }).click()
      await p.waitForTimeout(250)
      assert.equal(
        await workspace
          .getByRole('button', { name: 'Sort', exact: true })
          .count(),
        0
      )
      {
        for (const [condition, expected] of [
          ['New', 0],
          ['All conditions', 2],
        ]) {
          await workspace
            .getByRole('button', { name: 'Filter', exact: true })
            .click()
          await p
            .getByRole('combobox', { name: 'Condition', exact: true })
            .click()
          await p.getByRole('option', { name: condition, exact: true }).click()
          await p.waitForTimeout(220)
          await p
            .getByRole('region', { name: 'Filter options' })
            .getByRole('button', { name: 'Confirm', exact: true })
            .click()
          await p.waitForTimeout(300)
          assert.equal(
            await cards.count(),
            expected,
            'existing condition filter applies'
          )
        }
      }
      const lamp = workspace.locator('[data-resale-management-card="lamp"]')
      const createButton = workspace.getByRole('button', {
        name: width < 1024 ? 'Create' : 'Create Resale',
        exact: true,
      })
      await createButton.click()
      const createModal = p.getByRole('dialog', {
        name: 'Create Resale',
        exact: true,
      })
      await createModal.waitFor()
      await p.waitForTimeout(600)
      const createBounds = await createModal.boundingBox()
      assert.equal(
        await createModal.locator('[data-multi-step-form="0"]').count(),
        1
      )
      await createModal
        .getByRole('button', { name: 'Close Create Resale', exact: true })
        .click()
      await createModal.waitFor({ state: 'detached' })
      const previousUrl = p.url()
      await lamp
        .getByRole('button', { name: 'Edit listing', exact: true })
        .click()
      const editModal = p.getByRole('dialog', {
        name: 'Edit Resale',
        exact: true,
      })
      await editModal.waitFor()
      await p.waitForTimeout(400)
      const editBounds = await editModal.boundingBox()
      assert(
        Math.abs(createBounds.width - editBounds.width) < 1 &&
          (width < 768
            ? Math.abs(createBounds.height - editBounds.height) < 1
            : editBounds.height < createBounds.height - 20),
        'same shell width; desktop Edit follows compact Details; mobile height unchanged'
      )
      assert.equal(p.url(), previousUrl, 'no edit route navigation')
      assert.deepEqual(await p.evaluate(() => window.actions), [])
      assert.equal(
        await editModal.locator('[data-listing-creation-mode="edit"]').count(),
        0
      ) // attribute belongs to the dialog itself
      assert.equal(
        await editModal.getAttribute('data-listing-creation-mode'),
        'edit'
      )
      const editHeights = [editBounds.height]
      const checkEditSize = async (n) => {
        const b = await editModal.boundingBox()
        editHeights[n] = b.height
        const dimensions = await editModal
          .locator('[data-listing-wizard-scroll]')
          .evaluate((node) => ({
            content: node.firstElementChild.getBoundingClientRect().height,
            viewport: node.clientHeight,
            scroll: node.scrollHeight,
          }))
        assert(
          b.y >= 0 && b.y + b.height <= p.viewportSize().height + 1,
          'Edit stays in viewport'
        )
        if (width >= 768 && b.height < p.viewportSize().height - 65)
          assert(
            Math.abs(dimensions.content - dimensions.viewport) < 2,
            'Edit fits active content'
          )
        if (width >= 768 && dimensions.scroll > dimensions.viewport + 2)
          assert(
            Math.abs(b.height - (p.viewportSize().height - 64)) < 2,
            'Edit scroll only at viewport cap'
          )
        if (width < 768)
          assert(
            Math.abs(b.height - editBounds.height) < 1,
            'Edit mobile height unchanged'
          )
      }
      await checkEditSize(0)
      const next = async (n) => {
        await editModal
          .getByRole('button', { name: 'Continue', exact: true })
          .click()
        await editModal.locator(`[data-multi-step-form="${n}"]`).waitFor()
        await p.waitForTimeout(600)
        await checkEditSize(n)
      }
      assert.equal(
        await editModal
          .getByRole('heading', { name: 'Listing Details', exact: true })
          .count(),
        1
      )
      assert.equal(
        await editModal.getByRole('progressbar').getAttribute('aria-valuemax'),
        '4'
      )
      assert.equal(
        await editModal.getByRole('progressbar').locator('span').count(),
        4
      )
      assert.equal(
        await editModal.locator('[data-wizard-step="0"]').count(),
        0,
        'Photos omitted from Edit'
      )
      assert.equal(
        await editModal
          .getByRole('button', { name: 'Back', exact: true })
          .isDisabled(),
        true
      )
      assert.equal(
        await editModal
          .getByRole('combobox', { name: 'Category', exact: true })
          .count(),
        0,
        'locked category is non-interactive'
      )
      assert.equal(
        await editModal
          .locator('[data-wizard-step="1"]')
          .evaluate((n) => getComputedStyle(n).opacity),
        '1',
        'locked values not grayed'
      )
      assert.equal(
        await editModal.locator('input[name=title]').inputValue(),
        'Desk Lamp'
      )
      assert.equal(
        await editModal.locator('input[name=price]').inputValue(),
        '25.00'
      )
      await editModal
        .getByText('Category cannot be changed after publishing.', {
          exact: true,
        })
        .waitFor()
      await editModal.locator('input[name=title]').fill('Refined Desk Lamp')
      await next(1)
      await editModal.getByRole('button', { name: 'Back', exact: true }).click()
      await editModal.locator('[data-multi-step-form="0"]').waitFor()
      await p.waitForTimeout(550)
      assert.equal(
        await editModal.locator('input[name=title]').inputValue(),
        'Refined Desk Lamp',
        'draft survives Back/Continue'
      )
      await next(1)
      await next(2)
      await next(3)
      if (width >= 768)
        assert(
          editHeights[3] > editHeights[0] + 20,
          'Edit Review expands beyond Details'
        )
      console.log(
        'Edit modal heights',
        width,
        p.viewportSize().height,
        editHeights.map(Math.round)
      )
      await editModal
        .getByRole('heading', { name: 'Refined Desk Lamp', exact: true })
        .waitFor()
      assert.equal(await editModal.locator('input[type=file]').count(), 0)
      assert.deepEqual(await p.evaluate(() => window.creates), [])
      const confirm = editModal.getByRole('button', {
        name: 'Save Changes',
        exact: true,
      })
      if (width === 390 || width === 1280) {
        await p.evaluate(() => (window.failEdit = true))
        await confirm.click()
        await editModal
          .getByText('Fixture update failed', { exact: true })
          .waitFor()
        assert.equal(await editModal.count(), 1, 'failed update remains open')
        await editModal
          .getByRole('heading', { name: 'Refined Desk Lamp', exact: true })
          .waitFor()
        await p.evaluate(() => (window.failEdit = false))
        await p.waitForTimeout(2100)
      }
      await confirm.click()
      await editModal.waitFor({ state: 'detached' })
      await lamp.getByText('Refined Desk Lamp', { exact: true }).waitFor()
      assert(
        (await p.evaluate(() => window.edits)).every((id) => id === 'lamp'),
        'same listing id'
      )
      assert.equal(
        await p.evaluate(
          () => window.items.find((x) => x.id === 'lamp').listingChannel
        ),
        'resale'
      )
      assert.deepEqual(
        await p.evaluate(() => window.creates),
        [],
        'edit never creates'
      )
      assert(
        await p.evaluate(() =>
          window.editPatches.every(
            (p) =>
              !('category' in p) &&
              !('subcategory' in p) &&
              !('photoUrls' in p) &&
              !('listingChannel' in p)
          )
        ),
        'locked terms never patched'
      )
      // Existing expansion still works separately from management actions.
      await lamp.locator('button').first().click()
      await p.getByRole('dialog').waitFor()
      await p
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      const more = lamp.getByRole('button', {
        name: 'Listing actions for Refined Desk Lamp',
        exact: true,
      })
      for (let i = 0; i < 2; i++) {
        await more.focus()
        await p.keyboard.press('Enter')
        const menu = p.getByRole('menu', {
          name: 'Listing actions for Refined Desk Lamp',
        })
        await menu.waitFor()
        assert.equal(await menu.getByRole('menuitem').count(), 1)
        assert.equal(
          await menu
            .getByRole('menuitem', { name: 'Delete Listing', exact: true })
            .count(),
          1
        )
        const box = await menu.boundingBox()
        assert(box.x >= 0 && box.x + box.width <= width + 1)
        assert.equal(await p.getByRole('dialog').count(), 0)
        await p.keyboard.press('Escape')
        await menu.waitFor({ state: 'detached' })
      }
      await more.click()
      await p.mouse.click(width - 8, 950)
      await p.getByRole('menu').waitFor({ state: 'detached' })
      await more.click()
      await p
        .getByRole('menuitem', { name: 'Delete Listing', exact: true })
        .click()
      const confirmation = p.getByRole('dialog', {
        name: 'Delete this listing?',
        exact: true,
      })
      await confirmation.waitFor()
      assert.deepEqual(await p.evaluate(() => window.deletes), [])
      await confirmation
        .getByRole('button', { name: 'Delete', exact: true })
        .click()
      await confirmation.waitFor({ state: 'detached' })
      assert.deepEqual(await p.evaluate(() => window.deletes), ['lamp'])
      for (const card of await cards.all()) {
        const edit = await card
            .getByRole('button', { name: 'Edit listing', exact: true })
            .boundingBox(),
          action = await card
            .getByRole('button', { name: /Listing actions for/ })
            .boundingBox()
        assert(
          await card
            .getByRole('button', { name: 'Edit listing', exact: true })
            .evaluate((n) => n.scrollWidth <= n.clientWidth),
          'Edit label fits its button'
        )
        assert(
          Math.abs(edit.y - action.y) < 1 && edit.x + edit.width <= action.x,
          'actions stay inline'
        )
        const price = await card
            .locator('[class*="_price"]')
            .last()
            .boundingBox(),
          status = await card.locator('[data-state]').boundingBox()
        assert(
          price.x + price.width <= status.x,
          'price and status do not overlap'
        )
      }
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      assert.deepEqual(errors, [])
      await p.screenshot({
        path: path.join(root, `manage-resale-${width}.png`),
      })
      console.log(
        'PASS Profile + Manage Resale',
        width,
        'Profile scope, Create Resale action, Active/Sold, Sort/Filter, real editor, expansion, menu keyboard/outside, confirmed deletion, responsive geometry'
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
