/* global window, document, innerWidth, getComputedStyle */
// Actual Home navigation, owner workspace and Favorites; local data only.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { root, build } = require('./message-payload.browser.cjs')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')

async function run() {
  const layout = Boolean(process.env.SHOP_ANALYSIS_LAYOUT)
  const resaleLayout = Boolean(process.env.RESALE_MANAGEMENT_LAYOUT)
  const aliases = {}
  function mock(module, source) {
    const file = path.join(root, `nav-mock-${Object.keys(aliases).length}.tsx`)
    fs.writeFileSync(file, source)
    aliases[module] = file
    if (module.startsWith('@/')) aliases['./' + path.basename(module)] = file
  }
  mock(
    'next/router',
    `const router={query:{},events:{on(){},off(){}},push:async()=>true};export function useRouter(){router.query=window.query;return router}`
  )
  mock('next/dynamic', 'export default function dynamic(){return ()=>null}')
  mock(
    '@/components/@ui/link/link',
    'export function Link(p){return <a {...p}/> }'
  )
  mock('@ui/link/link', 'export function Link(p){return <a {...p}/> }')
  mock(
    '@/components/navigation/desktop-route-transition',
    'export function useDesktopRouteTransition(){return ()=>{}};export function usePendingDestination(){return null}'
  )
  mock(
    '@/components/home/order-visual-context',
    'const state={selection:null,showList(){}};export function useOrderVisual(){return state}'
  )
  mock(
    '@/components/home/profile-logout',
    'export function useProfileLogout(){return ()=>{}}'
  )
  mock(
    '@/components/home/settings-logout',
    'export function SettingsLogout(){return null}'
  )
  mock(
    '@/components/home/messages',
    'export function Messages(){return <p>Messages fixture</p>}'
  )
  mock(
    '@/components/home/orders',
    'export function Orders(){return <p>Orders fixture</p>}'
  )
  mock(
    '@/components/notifications/notifications-view',
    'export function NotificationsView(){return <p>Notifications fixture</p>}'
  )
  mock(
    '@/components/notifications/notification-bell',
    layout || resaleLayout
      ? `import styles from '@/components/notifications/notification-bell.module.css';export function NotificationBell(){return <button aria-label="Notifications" className={styles.bell}>Bell</button>}`
      : 'export function NotificationBell(){return <span/>}'
  )
  mock(
    '@/components/home/profile-overview',
    'export function ProfileOverview(){return <section aria-label="Profile account">Existing account information</section>}'
  )
  mock(
    '@/components/home/profile-analytics',
    'export function ProfileAnalytics(){return <section aria-label="Account chart">Your Activity</section>};export function AnalyticsPeriodControl(){return null}'
  )
  if (!layout)
    mock(
      '@/components/shops/shop-analytics',
      'export function ShopAnalysis(){return <section data-shop-surface="analysis"><h3>Shop Analysis</h3><p>Shop analytics become available when your Shop is active.</p></section>}'
    )
  mock(
    '@/components/listings/listing-form',
    'export function ListingForm({mode}){return mode==="shop"?<p>Your Shop isn&apos;t active yet.</p>:<form aria-label="Create Resale">Existing ListingForm</form>}'
  )
  mock(
    '@/components/listings/published-listing-card',
    'export function PublishedListingCard({listing}){return <div data-listing-channel={listing.listingChannel}>{listing.title}</div>}'
  )
  mock(
    '@/lib/listings-api',
    `export async function getMyListings(q){return window.ownerRead(q)};export async function marketplaceRequest(url){return window.favoriteRead(url)};export async function deleteListing(){throw Error('Unexpected mutation')};export async function markListingSold(){throw Error('Unexpected mutation')}`
  )
  if (layout || resaleLayout) {
    mock(
      '@/components/auth/auth-modal',
      'export function useAuthModal(){return {openAuth(){throw Error("Unexpected Auth action")}}}'
    )
    const progressEntry = path.join(root, 'real-radix-progress.tsx')
    fs.writeFileSync(
      progressEntry,
      `import * as Progress from '@radix-ui/react-progress';export {Progress}`
    )
    aliases['radix-ui'] = progressEntry
  }
  fs.writeFileSync(
    path.join(root, 'entry.tsx'),
    `
import '@/components/animata/button/shining-button.css';import 'tailwindcss/src/css/preflight.css';import '@/styles/desktop-app-tokens.css';import React from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {AnimatedSidebarDemo} from '@/components/home/animated-sidebar-demo';
const root=createRoot(document.getElementById('root'));let key=0;window.setSection=(section)=>{window.query={section};flushSync(()=>root.render(<LazyMotion features={domAnimation}><AnimatedSidebarDemo key={++key}/></LazyMotion>))};
`
  )
  fs.writeFileSync(
    path.join(root, 'index.html'),
    '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
  )
  await build(aliases)
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/^https?:/, (r) => {
        throw Error(`Unexpected network: ${r.request().url()}`)
      })
      await page.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      await page.evaluate(() => {
        window.calls = []
        const item = (channel) => ({
          id: channel,
          title: channel + ' item',
          photoUrls: [],
          seller: { id: 'owner', displayName: 'Fixture' },
          condition: 'good',
          listingChannel: channel,
          status: 'available',
          publishedAt: '2026-10-01',
          createdAt: '2026-10-01',
          price: 45,
          category: 'home-living',
        })
        window.ownerRead = async (q) => {
          window.calls.push(['owner', q.channel])
          return [item(q.channel)]
        }
        window.favoriteRead = async (url) => {
          const channel = new URL(
            url,
            'https://fixture.invalid'
          ).searchParams.get('channel')
          window.calls.push(['favorite', channel])
          return [item(channel)]
        }
        window.setSection('my-listings')
      })
      if (resaleLayout) {
        await page.evaluate(() => {
          window.ownerRead = async (q) =>
            [0, 1, 2, 3, 4].map((i) => ({
              id: 'owner-' + i,
              title: 'Resale item ' + i,
              photoUrls: [
                'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"%3E%3Crect width="400" height="400" fill="%234a3b56"/%3E%3Ccircle cx="200" cy="200" r="85" fill="%238b7799"/%3E%3C/svg%3E',
              ],
              seller: { id: 'owner', displayName: 'Fixture' },
              condition: 'good',
              listingChannel: q.channel,
              status: i === 1 ? 'pending' : 'available',
              publishedAt: '2026-10-01',
              createdAt: '2026-10-01',
              price: 2500,
              category: 'Home & Dorm',
              subcategory: 'Furniture',
            }))
          window.setSection('my-listings')
        })
        const cards = page.locator('[data-resale-management-card]')
        await cards.first().waitFor()
        await page.waitForTimeout(500)
        const title = page.getByRole('heading', {
          name: 'Manage Resale',
          exact: true,
        })
        const create = page.getByRole('button', {
          name: width < 1024 ? 'Create' : 'Create Resale',
          exact: true,
        })
        const filter = page.getByRole('button', { name: 'Filter', exact: true })
        const bell = page.getByRole('button', {
          name: 'Notifications',
          exact: true,
        })
        const active = page.getByRole('tab', { name: 'Active', exact: true })
        assert.equal(await title.count(), 1)
        assert.equal(await bell.count(), 1)
        assert.equal(
          await page
            .getByText('Manage your listings and their availability.', {
              exact: true,
            })
            .count(),
          0
        )
        assert.equal(
          await page.getByRole('button', { name: 'Sort', exact: true }).count(),
          0
        )
        const cb = await create.boundingBox(),
          ab = await active.boundingBox(),
          bb = await bell.boundingBox(),
          titleBox = await title.boundingBox()
        assert.equal(
          await create.evaluate((n) => getComputedStyle(n).backgroundColor),
          'rgb(124, 58, 237)'
        )
        assert(
          ab.y > titleBox.y + titleBox.height,
          'management row below title'
        )
        assert(
          Math.abs(ab.y + ab.height / 2 - cb.y - cb.height / 2) < 3,
          'tabs and Create share row'
        )
        const grid = await cards.first().evaluate((n) => ({
          columns: getComputedStyle(n.parentElement).gridTemplateColumns.split(
            ' '
          ).length,
          width: n.parentElement.clientWidth,
        }))
        assert.equal(grid.columns, width >= 1024 ? 5 : 2)
        if (width >= 1024) {
          assert.equal(await filter.count(), 1, 'desktop Filter restored')
          assert.equal(
            await title.evaluate((n) => getComputedStyle(n).fontSize),
            '18px',
            'shared Home title size'
          )
          assert.equal(
            await page
              .locator('[data-home-main]')
              .evaluate((n) => getComputedStyle(n).paddingTop),
            '24px',
            'standard Home inset'
          )
          assert(
            Math.abs(
              (await filter.boundingBox()).x +
                (await filter.boundingBox()).width -
                bb.x -
                bb.width
            ) < 2,
            'Filter right aligned to content'
          )
        }
        {
          const fb = await filter.boundingBox()
          assert(
            ab.x + ab.width <= cb.x && cb.x + cb.width <= fb.x,
            'Active Create Filter order'
          )
          assert(Math.abs(cb.y - fb.y) < 2, 'single mobile row')
          const scrollBefore = await page.evaluate(() => window.scrollY)
          await filter.click()
          const panel = page.getByRole('region', {
            name: 'Filter options',
            exact: true,
          })
          await panel.waitFor()
          assert(
            await panel
              .locator('..')
              .evaluate((n) => n.matches(':popover-open')),
            'Filter native top layer above app navigation'
          )
          await page.evaluate(() => {
            const nav = document.createElement('div')
            nav.id = 'nav-occlusion-fixture'
            nav.style.cssText =
              'position:fixed;inset:0;z-index:100002;pointer-events:auto'
            document.body.append(nav)
          })
          assert(
            await panel.evaluate((n) => {
              const b = n.getBoundingClientRect()
              return n.contains(document.elementFromPoint(b.x + 20, b.y + 20))
            }),
            'Filter above even app navigation layer'
          )
          await page.evaluate(() =>
            document.getElementById('nav-occlusion-fixture').remove()
          )
          await page.screenshot({
            path: path.join(root, `resale-filter-${width}.png`),
          })
          const pb = await panel.boundingBox()
          assert(
            pb.x >= 16 && pb.x + pb.width <= width - 15,
            'filter within viewport'
          )
          assert(Math.abs(pb.width - 320) < 2, 'usable panel width')
          assert(
            Math.abs(pb.x + pb.width - fb.x - fb.width) < 2,
            'filter opens left from trigger'
          )
          assert(
            await panel.evaluate(
              (n) => n.parentElement.parentElement === document.body
            ),
            'existing body portal'
          )
          assert.equal(
            await panel
              .locator('..')
              .evaluate((n) => getComputedStyle(n).zIndex),
            '70',
            'existing overlay layer'
          )
          for (const label of ['Category', 'Condition']) {
            const select = panel.getByRole('combobox', {
              name: label,
              exact: true,
            })
            assert(
              await select.evaluate((n) => n.scrollWidth <= n.clientWidth),
              'readable select width'
            )
            await select.click()
            const options = page.getByRole('listbox', {
              name: label,
              exact: true,
            })
            await options.waitFor()
            assert(
              await options.evaluate((n) =>
                n.parentElement.matches(':popover-open')
              ),
              'inner select top layer'
            )
            const box = await options.boundingBox()
            assert(
              box.x >= 0 &&
                box.x + box.width <= width + 1 &&
                box.y >= 0 &&
                box.y + box.height <= 900,
              'inner options contained'
            )
            await page.keyboard.press('Escape')
            assert.equal(
              await panel.count(),
              1,
              'inner Escape preserves Filter'
            )
          }
          await panel
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
          await panel.waitFor({ state: 'detached' })
          assert.equal(
            await page.evaluate(() => window.scrollY),
            scrollBefore,
            'no page jump on open/close'
          )
        }
        assert.equal(
          await page.getByRole('button', { name: /Favorite/ }).count(),
          0
        )
        assert(
          await page
            .locator('main:visible')
            .evaluateAll((ns) =>
              ns.every((n) => n.scrollWidth <= n.clientWidth + 1)
            )
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        const cardBox = await cards.first().boundingBox()
        assert(
          cardBox.y - ab.y - ab.height <= 40,
          'compact divider to cards spacing'
        )
        await page.screenshot({
          path: path.join(root, `resale-header-${width}.png`),
          fullPage: true,
        })
        await create.click()
        await page
          .getByRole('dialog', { name: 'Create Resale', exact: true })
          .waitFor()
        await page
          .getByRole('button', { name: 'Close Create Resale', exact: true })
          .click()
        await page.getByRole('dialog').waitFor({ state: 'detached' })
        assert.deepEqual(errors, [])
        if (process.env.SHOP_MANAGEMENT_LAYOUT) {
          await page.evaluate(() => window.setSection('my-shop'))
          const products = page.getByRole('region', {
            name: 'Manage Products',
            exact: true,
          })
          await products
            .locator('[data-shop-management-card]')
            .first()
            .waitFor()
          const shopTitle = page
            .getByRole('heading', { name: /Manage Products/ })
            .first()
          assert.equal(
            await shopTitle.evaluate((n) => getComputedStyle(n).fontSize),
            '18px'
          )
          assert.equal(
            await shopTitle
              .locator('.lucide-store')
              .evaluate((n) => getComputedStyle(n).color),
            'rgb(74, 222, 128)'
          )
          assert.equal(
            await shopTitle.locator('[data-shop-pro-badge]').isVisible(),
            width >= 640
          )
          assert(
            await shopTitle.evaluate((n) => n.scrollWidth <= n.clientWidth),
            'Shop title fits real Home header'
          )
          const search = products.getByRole('searchbox', {
            name: 'Search your products',
          })
          assert(await search.isVisible())
          assert.equal(
            await products
              .getByRole('button', {
                name: width < 1024 ? 'Add' : 'Add Product',
                exact: true,
              })
              .count(),
            1
          )
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            )
          )
          await page.screenshot({
            path: path.join(root, `shop-home-header-${width}.png`),
          })
          if (width === 390 || width === 1280) {
            await page.evaluate(() => {
              window.ownerRead = async (q) => {
                window.calls.push(['owner', q.channel])
                return []
              }
              window.calls = []
              window.setSection('my-shop')
            })
            await page.locator('[data-shop-management-demo]').waitFor()
            assert.equal(
              await page.locator('[data-shop-management-card]').count(),
              6
            )
            assert(
              (await page.evaluate(() => window.calls)).some(
                (call) => call[0] === 'owner' && call[1] === 'shop'
              ),
              'ordinary route reads Shop products before fallback'
            )
            assert(
              await page
                .getByRole('button', { name: 'Edit Product', exact: true })
                .first()
                .isDisabled()
            )
          }
          console.log('PASS actual Home Manage Products header', width)
        }
        console.log(
          'PASS actual Home Manage Resale header/grid',
          width,
          JSON.stringify({
            columns: grid.columns,
            create: cb,
            active: ab,
            bell: bb,
          })
        )
        await page.close()
        continue
      }
      if (layout) {
        await page.evaluate(() => window.setSection('shop-analysis'))
        await page.getByRole('table').waitFor()
        await page.waitForTimeout(500)
        assert.equal(
          await page
            .getByRole('heading', { name: 'Shop Analysis', exact: true })
            .count(),
          1
        )
        assert.equal(
          await page
            .getByText('Track your sales, expenses and profitability.', {
              exact: true,
            })
            .count(),
          0
        )
        assert.equal(
          await page
            .getByRole('complementary', { name: 'Demo analytics disclosure' })
            .count(),
          0
        )
        const date = page.getByRole('button', {
          name: 'Date range',
          exact: true,
        })
        const bell = page.getByRole('button', {
          name: 'Notifications',
          exact: true,
        })
        const db = await date.boundingBox(),
          bb = await bell.boundingBox()
        if (width >= 768) {
          assert(
            Math.abs(bb.x - db.x - db.width - 12) < 2,
            'date immediately before bell'
          )
          assert(
            Math.abs(db.y + db.height / 2 - bb.y - bb.height / 2) < 2,
            'header controls centered'
          )
        } else {
          const surface = await page
            .locator('[data-shop-surface="analysis"]')
            .boundingBox()
          assert(
            Math.abs(db.width - surface.width) < 2,
            'mobile full width date'
          )
          assert(db.y >= bb.y + bb.height, 'date below mobile header')
        }
        const expense = page.getByRole('heading', {
          name: 'Expense Breakdown',
          exact: true,
        })
        const order = page.getByRole('heading', {
          name: 'Order Overview',
          exact: true,
        })
        const add = page.getByRole('button', {
          name: 'Add Expense',
          exact: true,
        })
        const eb = await expense.boundingBox(),
          ob = await order.boundingBox(),
          ab = await add.boundingBox()
        assert(
          Math.abs(eb.y + eb.height / 2 - ab.y - ab.height / 2) < 2,
          'compact action on heading row'
        )
        assert(ab.height <= 40 && ab.width < 160, 'secondary action compact')
        assert(ab.x >= eb.x + eb.width, 'title and action do not overlap')
        if (width >= 1024)
          assert(Math.abs(eb.y - ob.y) < 2, 'sibling headings aligned')
        else assert(ob.y > eb.y, 'business modules stack')
        assert(
          await page
            .locator('th,td')
            .evaluateAll((ns) =>
              ns.every(
                (n) =>
                  getComputedStyle(n).textAlign === 'center' &&
                  getComputedStyle(n).verticalAlign === 'middle'
              )
            ),
          'all table cells centered'
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          'no page overflow'
        )
        await expense.evaluate((n) => n.scrollIntoView({ block: 'start' }))
        await page.screenshot({
          path: path.join(root, `shop-analysis-business-${width}.png`),
        })
        assert(
          await page
            .locator('main:visible')
            .evaluateAll((ns) =>
              ns.every((n) => n.scrollWidth <= n.clientWidth + 1)
            ),
          'no workspace overflow'
        )
        await page.getByRole('table').scrollIntoViewIfNeeded()
        await page.screenshot({
          path: path.join(root, `shop-analysis-table-${width}.png`),
        })
        await date.scrollIntoViewIfNeeded()
        await date.click()
        await page
          .getByRole('button', { name: 'This Week', exact: true })
          .click()
        await page.locator('[data-analysis-range="week"]').waitFor()
        assert.equal(
          await page.getByRole('dialog').count(),
          0,
          'date selection does not open plans'
        )
        await page.keyboard.press('Escape')
        if (width === 820) {
          await page.setViewportSize({ width: 430, height: 900 })
          await page.waitForTimeout(400)
          assert.equal(await date.count(), 1)
          assert.equal(
            await page.locator('[data-analysis-range="week"]').count(),
            1
          )
          assert.equal(
            await page.locator('[data-shop-analysis-date-slot] button').count(),
            0
          )
          await page.setViewportSize({ width: 820, height: 900 })
          await page.waitForTimeout(400)
          assert.equal(
            await page.locator('[data-shop-analysis-date-slot] button').count(),
            1
          )
          assert.equal(
            await page.locator('[data-analysis-range="week"]').count(),
            1
          )
        }

        await page.screenshot({
          path: path.join(root, `shop-analysis-layout-${width}.png`),
          fullPage: true,
        })
        assert.deepEqual(errors, [])
        console.log(
          'PASS actual Home Shop Analysis layout',
          width,
          JSON.stringify({ date: db, expense: eb, add: ab, order: ob })
        )
        await page.close()
        continue
      }
      const mobile = width < 1024
      const nav = mobile
        ? page.locator('[data-smooth-menu]')
        : page.locator('[data-slot="sidebar-body"]')
      const content = mobile
        ? page.locator('main').first()
        : page.locator('[data-home-main]')
      const open = async () => {
        if (mobile) {
          const trigger = page.getByRole('button', {
            name: 'Open Home navigation',
            exact: true,
          })
          if ((await trigger.getAttribute('aria-expanded')) === 'false')
            await trigger.click()
        } else await nav.hover()
      }
      const parent = (name) =>
        nav.getByRole(mobile ? 'button' : 'link', { name, exact: true })
      const child = (name) => nav.getByRole('button', { name, exact: true })
      await content
        .getByRole('region', { name: 'Manage Resale', exact: true })
        .waitFor()
      await content.getByText('resale item', { exact: true }).waitFor()
      await open()
      assert.equal(await nav.getByText('Listings', { exact: true }).count(), 0)
      assert.equal(await nav.getByText('Analysis', { exact: true }).count(), 0)
      assert.equal(await nav.getByText('Overview', { exact: true }).count(), 0)
      assert.deepEqual(
        await nav
          .locator(mobile ? '.unused' : 'a[href^="#"]')
          .allTextContents(),
        mobile
          ? []
          : [
              'Profile',
              'My Resale',
              'My ShopPLUS+',
              'Messages',
              'Orders',
              'Settings',
            ]
      )
      assert.equal(
        await child('Manage Resale').getAttribute('aria-current'),
        'page'
      )
      await parent('My Resale').click()
      assert.equal(
        await parent('My Resale').getAttribute('aria-expanded'),
        'false'
      )
      await parent('My Resale').click()
      assert.equal(
        await parent('My Resale').getAttribute('aria-expanded'),
        'true'
      )
      for (const label of ['Manage Resale', 'Resale Favorites'])
        await child(label).waitFor({ state: 'visible' })
      await parent('My Shop').click()
      assert.equal(
        await parent('My Shop').getAttribute('aria-expanded'),
        'true'
      )
      await content
        .getByRole('region', { name: 'Manage Resale', exact: true })
        .waitFor()
      const names = ['Manage Products', 'Shop Favorites', 'Shop Analysis']
      for (const name of names) await child(name).waitFor({ state: 'visible' })
      const badge = parent('My Shop').locator('[data-shop-pro-badge]')
      assert.equal((await badge.textContent()).trim(), 'PLUS+')
      assert.equal(
        await badge
          .locator('svg')
          .evaluate((n) => n.getBoundingClientRect().width),
        14
      )
      assert.equal(
        await child('Shop Analysis').locator('[data-shop-pro-badge]').count(),
        0
      )
      assert.equal(await nav.locator('[data-shop-pro-badge]').count(), 1)
      await page.waitForTimeout(300)
      await page.screenshot({ path: path.join(root, `nav-${width}.png`) })
      // Geometry: badges stay within their own row and viewport, without growing rows.
      for (const row of [parent('My Shop')]) {
        const box = await row.boundingBox(),
          b = await row.locator('[data-shop-pro-badge]').boundingBox()
        assert(
          b.x >= box.x && b.x + b.width <= box.x + box.width + 1,
          'badge fits row'
        )
        assert(
          b.y >= box.y - 1 && b.y + b.height <= box.y + box.height + 1,
          'badge fits row height'
        )
        const reference = await ((await row.getAttribute('aria-label')) ===
        'My Shop'
          ? parent('My Resale')
          : child('Manage Products')
        ).boundingBox()
        assert(
          Math.abs(box.height - reference.height) < 1,
          `badge keeps existing row height (${width}: ${await row.getAttribute(
            'aria-label'
          )}, ${box.height} vs ${reference.height})`
        )
        assert(
          box.x >= 0 && box.x + box.width <= width + 1,
          'row fits viewport'
        )
      }
      const analysisRow = await child('Shop Analysis').boundingBox()
      const otherRow = await child('Manage Products').boundingBox()
      assert(
        Math.abs(analysisRow.height - otherRow.height) < 1,
        'Shop Analysis remains a single text row'
      )
      if (mobile)
        assert.equal(
          await nav
            .locator('..')
            .evaluate((n) => n.getBoundingClientRect().width),
          256
        )
      await child('Shop Analysis').click()
      await content.locator('[data-shop-surface="analysis"]').waitFor()
      assert.equal(
        await content.locator('[data-shop-surface="analysis"]').count(),
        1
      )
      await content
        .getByText(
          'Shop analytics become available when your Shop is active.',
          { exact: true }
        )
        .waitFor()
      await open()
      await parent('Profile').click()
      await content
        .getByRole('region', { name: 'Account Analytics', exact: true })
        .waitFor()
      assert.equal(
        await content.locator('[data-shop-surface="analysis"]').count(),
        0
      )
      assert.equal(
        await content.getByText('Shop Analysis', { exact: true }).count(),
        0
      )
      await content.getByText('Your Activity', { exact: true }).waitFor()
      for (const [group, label, scope, kind] of [
        ['My Shop', 'Manage Products', 'shop', 'owner'],
        ['My Shop', 'Shop Favorites', 'shop', 'favorite'],
        ['My Resale', 'Resale Favorites', 'resale', 'favorite'],
        ['My Resale', 'Manage Resale', 'resale', 'owner'],
      ]) {
        await open()
        if ((await parent(group).getAttribute('aria-expanded')) !== 'true')
          await parent(group).click()
        await page.evaluate(() => {
          window.calls = []
        })
        await child(label).click()
        await content
          .getByRole('region', { name: label, exact: true })
          .waitFor()
        await content.getByText(scope + ' item', { exact: true }).waitFor()
        const calls = await page.evaluate(() => window.calls)
        assert(
          calls.some((c) => c[0] === kind && c[1] === scope),
          `${label} sends authoritative ${scope} query`
        )
        assert(
          !calls.some((c) => c[0] === kind && c[1] !== scope),
          'no unscoped/opposite channel read'
        )
      }
      await open()
      await parent('My Shop').click()
      await child('Manage Products').click()
      await content
        .getByRole('button', { name: 'Add Product', exact: true })
        .click()
      await page
        .getByRole('dialog', { name: 'Add Product', exact: true })
        .getByText("Your Shop isn't active yet.", { exact: true })
        .waitFor()
      assert.equal(
        await content.locator('form').count(),
        0,
        'Add Product does not expose Resale form'
      )
      await page
        .getByRole('button', { name: 'Close Add Product', exact: true })
        .click()
      await page.getByRole('dialog').waitFor({ state: 'detached' })
      assert.equal(await child('Create Resale').count(), 0)
      assert.equal(await child('Add Product').count(), 0)
      // Old IDs remain real destinations, with updated visible names.
      for (const [id, label] of [
        ['my-listings', 'Manage Resale'],
        ['create-listing', 'Create Resale'],
        ['favorites', 'Resale Favorites'],
        ['my-shop', 'Manage Products'],
        ['create-shop-listing', 'Add Product'],
        ['shop-favorites', 'Shop Favorites'],
        ['shop-analysis', 'Shop Analysis'],
      ]) {
        await page.evaluate((id) => window.setSection(id), id)
        await page
          .getByRole('heading', { name: label, exact: true })
          .first()
          .waitFor()
        if (id === 'create-listing')
          await page
            .getByRole('dialog', { name: 'Create Resale', exact: true })
            .getByRole('form', { name: 'Create Resale', exact: true })
            .waitFor()
      }
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        'no horizontal overflow'
      )
      if (!mobile) {
        await open()
        await parent('Messages').click()
        await content.getByText('Messages fixture', { exact: true }).waitFor()
        await child('Buying').waitFor({ state: 'visible' })
        await parent('Orders').click()
        await content.getByText('Orders fixture', { exact: true }).waitFor()
        await child('Purchases').waitFor({ state: 'visible' })
      }
      assert.deepEqual(errors, [])
      console.log(
        `Home IA ${width}: hierarchy, disclosure, badge geometry, Profile, scopes, deep links PASS`
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
