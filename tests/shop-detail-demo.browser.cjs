/* global window, document, getComputedStyle, MutationObserver */
// Offline Shop browsing prototype: all production display primitives, zero API/session activity.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'shop-demo-link.jsx'),
  `import React from 'react';export const Link=props=><a {...props}/>;`
)
aliases['@ui/link/link'] = path.join(root, 'shop-demo-link.jsx')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState} from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{ShopDirectory}from'@/components/shops/shop-directory';import{MarketFeedViewport}from'@/components/listings/market-feed-viewport';import market from '@/components/listings/market-layout.module.css';window.actions=[];window.overlays=[];function App(){const[detail,setDetail]=useState(false);return <LazyMotion features={domAnimation}><main className={market.page}><header data-fixture-market-header className={market.stickyHeader} style={{height:72,flexShrink:0}}>Marketplace controls</header><div className={market.content} style={{maxWidth:1248,width:'100%',margin:'auto'}}>{!detail&&<nav data-fixture-breadcrumb>Shop</nav>}<MarketFeedViewport mode="shop" resale={null} shop={<ShopDirectory onDetailActiveChange={setDetail} onOverlayActiveChange={value=>window.overlays.push(value)}/>}/></div></main></LazyMotion>};createRoot(document.getElementById('root')).render(<App/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#fafafa;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
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
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reduced of [false, true]) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
          hasTouch: true,
        })
        p.setDefaultTimeout(8000)
        const errors = []
        let network = 0
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const u = new URL(r.request().url())
          if (u.origin !== 'http://localhost:4177') {
            network++
            return r.abort()
          }
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
          if (
            u.pathname.startsWith('/static/') ||
            u.pathname.startsWith('/demo/')
          )
            return r.fulfill({ path: 'public' + u.pathname })
          network++
          return r.abort()
        })
        await p.goto('http://localhost:4177/')
        const workspace = p.locator('[data-shop-workspace]'),
          slider = p.locator('[data-overlapping-slider]')
        await workspace.waitFor()
        await p
          .getByRole('heading', { name: 'All Shops', exact: true })
          .waitFor()
        assert.equal(
          await slider
            .locator('[data-active="true"]')
            .getAttribute('data-slider-index'),
          '2'
        )
        const carousel = slider.getByRole('region')
        await carousel.focus()
        await p.keyboard.press('ArrowRight')
        await p.waitForTimeout(420)
        const sliderIndex = await slider
          .locator('[data-active="true"]')
          .getAttribute('data-slider-index')
        const entry = workspace.locator('[data-demo-shop-entry]'),
          go = entry.getByRole('button', {
            name: 'Go to Luna Studio demo shop',
          })
        await go.scrollIntoViewIfNeeded()
        await p.waitForTimeout(100)
        const scrollY = await p.evaluate(() => window.scrollY),
          before = await go.boundingBox()
        await p.evaluate(() => {
          window.views = []
          window.transitions = new MutationObserver(() => {
            const el = document.querySelector('[data-shop-workspace]')
            window.views.push(el?.dataset.shopWorkspace)
          })
          window.transitions.observe(
            document.querySelector('[data-shop-workspace]'),
            { attributes: true, attributeFilter: ['data-shop-workspace'] }
          )
        })
        await go.click()
        assert.equal(await go.getAttribute('aria-busy'), 'true')
        assert.equal(await go.getAttribute('data-state'), 'loading')
        assert.equal(await go.getAttribute('aria-disabled'), 'true')
        const pendingBox = await go.boundingBox()
        assert(
          Math.abs(pendingBox.width - before.width) < 1 &&
            Math.abs(pendingBox.height - before.height) < 1,
          'loading geometry stable'
        )
        await go.dispatchEvent('click')
        const skeleton = workspace.locator('[data-shop-detail-skeleton]')
        await skeleton.waitFor()
        assert.equal(
          await skeleton
            .locator('[aria-label="Loading listings"] article')
            .count(),
          12
        )
        assert.equal(
          await skeleton
            .locator('[class*="_listingMedia"]')
            .first()
            .evaluate((el) => getComputedStyle(el).aspectRatio),
          '1 / 1'
        )
        const skeletonProfile = skeleton.locator('section').first()
        assert.equal(
          await skeletonProfile.evaluate(
            (el) => getComputedStyle(el).backgroundColor
          ),
          'rgb(27, 21, 35)',
          'skeleton unchanged'
        )
        const skeletonBox = await skeleton.boundingBox()
        const detail = workspace.locator('[data-shop-detail-demo]')
        await detail.waitFor()
        await p.waitForTimeout(250)
        assert.equal(
          await p
            .getByRole('heading', { name: 'All Shops', exact: true })
            .count(),
          0
        )
        assert.equal(
          await workspace
            .getByRole('button', { name: 'Back to shop list' })
            .count(),
          1
        )
        assert.equal(new URL(p.url()).pathname, '/')
        assert(scrollY > 0, 'opened after scrolling down in Directory')
        assert.equal(
          await p.evaluate(() => window.scrollY),
          0,
          'Detail starts at its own top'
        )
        const assertBoundary = async () => {
          assert.equal(
            await p.evaluate(() => document.scrollingElement.scrollTop),
            0
          )
          const backBox = await workspace
            .getByRole('button', { name: 'Back to shop list' })
            .boundingBox()
          const headerBox = await p
            .locator('[data-fixture-market-header]')
            .boundingBox()
          assert(
            Math.abs(backBox.y - (headerBox.y + headerBox.height)) < 1,
            'Back is the first content below header'
          )
          assert.equal(
            await slider.isVisible(),
            false,
            'Recommended not in Detail scroll surface'
          )
          assert.equal(
            await p
              .locator('[data-shop-directory-content]')
              .evaluate((n) => getComputedStyle(n).display),
            'none'
          )
          assert.equal(await p.locator('[data-fixture-breadcrumb]').count(), 0)
          assert.equal(
            await p
              .getByRole('complementary', { name: 'Shop Pro promotion' })
              .count(),
            0
          )
        }
        await p.waitForTimeout(400)
        await assertBoundary()
        await p.mouse.move(width / 2, 600)
        await p.mouse.wheel(0, 900)
        await p.waitForTimeout(150)
        assert(
          await p.evaluate(() => window.scrollY > 0),
          'Detail scrolls down normally'
        )
        for (let i = 0; i < 4; i++) await p.mouse.wheel(0, -1800)
        await p.waitForTimeout(200)
        await assertBoundary()
        await p.evaluate(() => {
          document.scrollingElement.scrollTop = 900
        })
        assert(await p.evaluate(() => window.scrollY > 0))
        await p.evaluate(() => {
          document.scrollingElement.scrollTop = -10000
        })
        await assertBoundary()
        assert.equal(
          await slider
            .locator('[data-active="true"]')
            .getAttribute('data-slider-index'),
          sliderIndex
        )
        const transitions = await p.evaluate(() => window.views)
        assert(
          transitions.includes('loading') && transitions.includes('detail')
        )
        assert.equal(
          transitions.filter((x) => x === 'loading').length,
          1,
          'duplicate action creates one load'
        )
        await p.evaluate(() => window.transitions.disconnect())
        const profile = detail.locator(
          '[aria-label="Luna Studio demo profile"]'
        )
        assert(
          (await profile.textContent()).includes(
            'Handmade accessories made by a Western student. Each piece is carefully designed and crafted. Available for campus pickup.'
          )
        )
        for (const text of [
          '4.9',
          '24 reviews',
          '68',
          '12',
          'Western email verified',
        ])
          assert((await profile.textContent()).includes(text))
        const profileChrome = await profile.evaluate((el) => {
          const s = getComputedStyle(el),
            stats = el.querySelector('[class*="_stats"]')
          return {
            background: s.backgroundColor,
            border: s.borderColor,
            borderWidth: s.borderTopWidth,
            radius: s.borderRadius,
            shadow: s.boxShadow,
            stats: Array.from(stats.children).map(
              (item) => getComputedStyle(item).backgroundColor
            ),
          }
        })
        assert.equal(profileChrome.background, 'rgba(0, 0, 0, 0)')
        assert.equal(profileChrome.border, 'rgba(0, 0, 0, 0)')
        assert.equal(
          profileChrome.borderWidth,
          '1px',
          'preserve original content offsets'
        )
        assert.equal(profileChrome.radius, '0px')
        assert.equal(profileChrome.shadow, 'none')
        assert.deepEqual(
          profileChrome.stats,
          Array(3).fill('rgb(38, 29, 48)'),
          'three stat surfaces preserved'
        )
        if (!reduced)
          await profile.screenshot({
            path: path.join(root, `shop-demo-profile-${width}.png`),
          })
        await profile.getByRole('button', { name: 'Contact shop' }).click()
        assert.equal(await p.getByRole('dialog').count(), 0)
        assert.equal(new URL(p.url()).pathname, '/')
        const products = detail.locator('[data-demo-shop-products]'),
          cards = products.locator('[data-demo-listing]')
        assert.equal(await cards.count(), 12)
        const geometry = await products.evaluate((el) => ({
          cols: getComputedStyle(el).gridTemplateColumns.split(' ').length,
          overflow: document.documentElement.scrollWidth > window.innerWidth,
        }))
        assert.equal(
          geometry.cols,
          width < 640 ? 2 : width < 1024 ? 3 : width < 1440 ? 4 : 5
        )
        assert(!geometry.overflow, 'no horizontal overflow')
        const first = cards.first()
        assert.equal(
          await first
            .locator('[data-slot="expandable-card"] > span')
            .first()
            .evaluate((el) => getComputedStyle(el).aspectRatio),
          '1 / 1'
        )
        assert((await first.textContent()).includes('Wooden accent chair'))
        await first.getByRole('button', { name: 'Add to favorites' }).click()
        await p.waitForTimeout(600)
        assert.equal(
          await first
            .getByRole('button', { name: 'Remove from favorites' })
            .getAttribute('aria-pressed'),
          'true'
        )
        await first.locator('[data-slot="expandable-card"]').click()
        const dialog = p.getByRole('dialog')
        await dialog.waitFor()
        await p.waitForTimeout(450)
        assert.equal(
          await dialog
            .locator(':scope > div:first-child > div:first-child')
            .evaluate((el) => getComputedStyle(el).aspectRatio),
          width < 768 ? '4 / 3' : '4 / 5'
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: /Message Seller|Make Offer/ })
            .count(),
          0
        )
        await p.keyboard.press('Escape')
        await dialog.waitFor({ state: 'detached' })
        const search = detail.getByRole('searchbox', {
          name: 'Search products in this shop',
        })
        await search.fill('necklace')
        assert.equal(await cards.count(), 1)
        assert(
          (await cards.first().textContent()).includes('Statement Necklace')
        )
        await search.fill('Jewelry')
        assert.equal(await cards.count(), 3)
        await search.fill('')
        await detail.getByRole('button', { name: 'Sort', exact: true }).click()
        await p
          .getByRole('button', { name: 'Price: Low to High', exact: true })
          .click()
        await p.waitForTimeout(350)
        assert((await cards.first().textContent()).includes('Ceramic mug'))
        await detail.getByRole('button', { name: 'Sort', exact: true }).click()
        await p
          .getByRole('button', { name: 'Price: High to Low', exact: true })
          .click()
        await p.waitForTimeout(350)
        assert(
          (await cards.first().textContent()).includes('Wooden accent chair')
        )
        await detail.getByRole('tab', { name: 'Reviews (24)' }).click()
        await detail
          .getByText(
            'Reviews will appear here when Shop Reviews are connected.'
          )
          .waitFor()
        await detail.getByRole('tab', { name: 'Reviews (24)' }).focus()
        await p.keyboard.press('ArrowRight')
        assert.equal(
          await detail
            .getByRole('tab', { name: 'About', exact: true })
            .getAttribute('aria-selected'),
          'true'
        )
        await detail.getByRole('tab', { name: 'Products (12)' }).click()
        assert.equal(await cards.count(), 12)
        assert.equal(
          await cards
            .first()
            .getByRole('button', { name: 'Remove from favorites' })
            .getAttribute('aria-pressed'),
          'true'
        )
        await p.screenshot({
          path: path.join(root, `shop-detail-demo-${width}-${reduced}.png`),
          fullPage: false,
        })
        const back = workspace.getByRole('button', {
          name: 'Back to shop list',
        })
        await back.scrollIntoViewIfNeeded()
        await p.waitForTimeout(100)
        await back.click()
        await workspace
          .getByRole('heading', { name: 'All Shops', exact: true })
          .waitFor()
        await entry.waitFor()
        await p.waitForTimeout(250)
        assert(
          await go.evaluate((el) => document.activeElement === el),
          'directory CTA focus restored'
        )
        assert.equal(
          await p.evaluate(() => window.scrollY),
          scrollY,
          'Back restores saved Directory position'
        )
        assert.equal(
          await slider
            .locator('[data-active="true"]')
            .getAttribute('data-slider-index'),
          sliderIndex
        )
        assert(
          await p
            .getByRole('complementary', { name: 'Shop Pro promotion' })
            .isVisible()
        )
        assert.equal(
          await p
            .getByRole('heading', { name: 'All Shops', exact: true })
            .count(),
          1
        )
        await p
          .getByRole('button', { name: 'Dismiss Shop Pro promotion' })
          .click()
        await p
          .getByRole('complementary', { name: 'Shop Pro promotion' })
          .waitFor({ state: 'detached' })
        await go.click()
        await detail.waitFor()
        await workspace
          .getByRole('button', { name: 'Back to shop list' })
          .click()
        await entry.waitFor()
        assert.equal(
          await p
            .getByRole('complementary', { name: 'Shop Pro promotion' })
            .count(),
          0,
          'dismissed promo stays dismissed'
        )
        await p.waitForTimeout(400)
        assert.equal(
          await p.evaluate(() =>
            document.documentElement.style.getPropertyValue('overflow-anchor')
          ),
          '',
          'temporary anchor suppression cleaned up'
        )
        // The recommended Luna card enters the same workspace without remounting the slider.
        await carousel.focus()
        await p.keyboard.press('Home')
        await p.waitForTimeout(430)
        const recommendedEntry = slider.getByRole('button', {
          name: 'Go to Luna Studio demo shop',
        })
        await recommendedEntry.click()
        assert.equal(await recommendedEntry.getAttribute('aria-busy'), 'true')
        await detail.waitFor()
        await workspace
          .getByRole('button', { name: 'Back to shop list' })
          .click()
        await entry.waitFor()
        await p.waitForTimeout(400)
        assert.equal(
          await slider
            .locator('[data-active="true"]')
            .getAttribute('data-slider-index'),
          '0'
        )
        assert.equal(
          await p.evaluate(() =>
            document.documentElement.style.getPropertyValue('overflow-anchor')
          ),
          ''
        )
        assert(
          await recommendedEntry.evaluate(
            (el) => document.activeElement === el
          ),
          'recommended CTA focus restored'
        )
        assert.equal(network, 0)
        assert.deepEqual(errors, [])
        console.log(
          'PASS Shop detail demo',
          width,
          'reduced=' + reduced,
          'busy/skeleton/detail/back, profile/tabs/local search-sort, shared Listing/favorites/expand, stable viewport, zero network',
          JSON.stringify({
            skeletonHeight: skeletonBox.height,
            columns: geometry.cols,
          })
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
