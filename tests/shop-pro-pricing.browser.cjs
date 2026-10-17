/* global window, document, getComputedStyle */
// Offline UI-only pricing qualification. Real directory/cards, dialog and My Shop.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';import {LazyMotion,domAnimation} from 'framer-motion';import {MarketFeedViewport} from '@/components/listings/market-feed-viewport';import {ShopDirectory} from '@/components/shops/shop-directory';import {ShopListingWorkspace} from '@/components/shops/shop-listing-workspace';import {Sidebar,SidebarBody} from '@/components/velora/animated-sidebar';import {SectionHeader} from '@/components/home/section-header';import home from '@/components/home/animated-sidebar-demo.module.css';import '@/styles/desktop-app-tokens.css';
const root=createRoot(document.getElementById('root'));window.actions=[];window.requests=[];window.fixtureRequest=async(...args)=>{window.requests.push(args);throw Error('No requests permitted')};window.process={env:{}};
const shops=[{sellerProfileId:'fixture',username:'fixture_shop',shopName:'Vintage Loop',category:'Electronics',description:'Curated campus finds.'}];
function Home({create}){return <div className={home.page}><div className={home.mobileShell}><header className={home.mobileHeader}><h1>My Shop</h1></header><main className={home.mobileMain}><ShopListingWorkspace create={create}/></main></div><Sidebar className={home.frame}><SidebarBody logo={<span/>} title='Home'><span>Listings</span></SidebarBody><main className={home.main} data-home-main><SectionHeader title='My Shop'/><ShopListingWorkspace create={create}/></main></Sidebar></div>};function App({surface}){const [mode,setMode]=useState('resale');return <LazyMotion features={domAnimation}>{surface!=='market'?<Home create={surface==='create'}/>:<main style={{maxWidth:1200,margin:'0 auto',padding:20,minHeight:1400}}>{surface==='market'?<><header data-fixed-controls><button onClick={()=>setMode('resale')}>Resale</button><button onClick={()=>setMode('shop')}>Shop</button></header><MarketFeedViewport mode={mode} resale={<p>Resale listings</p>} shop={<ShopDirectory shops={shops}/>}/></>:<ShopListingWorkspace create={surface==='create'}/>}</main>}</LazyMotion>};let n=0;window.show=surface=>flushSync(()=>root.render(<App key={++n} surface={surface}/>));
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#160f1d;color:white;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
;(async () => {
  await build(aliases)
  fs.unlinkSync(path.join(root, 'entry.tsx'))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reducedMotion of ['reduce', 'no-preference']) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion,
        })
        p.setDefaultTimeout(7000)
        let network = 0
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => {
          network++
          return r.abort()
        })
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await p.evaluate(() => window.show('market'))
        assert.equal(
          await p
            .getByRole('complementary', { name: 'Shop Pro promotion' })
            .count(),
          0
        )
        const header = await p.locator('[data-fixed-controls]').boundingBox()
        await p.getByRole('button', { name: 'Shop', exact: true }).click()
        const banner = p.getByRole('complementary', {
          name: 'Shop Pro promotion',
        })
        await banner.waitFor()
        await p.waitForTimeout(500)
        assert.deepEqual(
          await p.locator('[data-fixed-controls]').boundingBox(),
          header
        )
        await p
          .getByRole('button', { name: 'Open shop: Vintage Loop' })
          .waitFor()
        if (reducedMotion === 'reduce' && [390, 1280].includes(width))
          await p.screenshot({
            path: 'tests/artifacts/shop-pro-pricing-banner-' + width + '.png',
          })
        const opener = banner.getByRole('button', {
          name: 'Explore Shop Pro',
          exact: true,
        })
        const bannerGeometry = await banner.evaluate((el) => {
          const r = (e) => e.getBoundingClientRect().toJSON()
          return {
            banner: r(el),
            cta: r(el.querySelector('button:not([aria-label])')),
            close: r(el.querySelector('[aria-label]')),
          }
        })
        assert(
          Math.abs(
            bannerGeometry.banner.right -
              bannerGeometry.cta.right -
              (width < 640 ? 20 : 24)
          ) < 1,
          'banner CTA right inset'
        )
        assert(
          Math.abs(
            bannerGeometry.banner.bottom - bannerGeometry.cta.bottom - 20
          ) < 1,
          'banner CTA bottom inset'
        )
        assert(
          bannerGeometry.cta.width < bannerGeometry.banner.width - 60,
          'banner CTA not full-width'
        )
        assert(bannerGeometry.close.y < bannerGeometry.cta.y, 'X above CTA')
        await opener.click()
        const dialog = p.getByRole('dialog', { name: 'Shop Pro plans' })
        await dialog.waitFor()
        await p.waitForTimeout(450)
        const overlay = await dialog.evaluate((el) => {
          const body = el.querySelector('[data-shop-pro-pricing]').parentElement
          const css = getComputedStyle(el)
          return {
            rect: el.getBoundingClientRect().toJSON(),
            slide: css.getPropertyValue('--sheet-slide-distance').trim(),
            animation: css.animationName,
            transform: css.transform,
            scrolls: body.scrollHeight > body.clientHeight + 1,
            scrollTop: body.scrollTop,
          }
        })
        if (width < 640) {
          assert(
            Math.abs(overlay.rect.bottom - 900) < 1,
            'mobile bottom attached'
          )
          assert.equal(overlay.rect.width, width, 'mobile natural full width')
          assert.equal(overlay.slide, '', 'mobile full-height entrance')
        } else {
          assert(
            Math.abs((overlay.rect.top + overlay.rect.bottom) / 2 - 450) < 1,
            'wide dialog vertically centered'
          )
          assert(
            overlay.rect.top >= 24 && overlay.rect.bottom <= 876,
            'comfortable top/bottom margins'
          )
          assert(
            overlay.rect.left >= 24 && overlay.rect.right <= width - 24,
            'wide dialog horizontal margins'
          )
          assert.equal(overlay.slide, '24px', 'wide dialog short slide')
          assert(
            !overlay.scrolls,
            'no internal scroll when desktop content fits'
          )
        }
        assert.equal(overlay.scrollTop, 0, 'opens at top')
        if (reducedMotion === 'reduce') {
          assert.equal(overlay.animation, 'none')
          assert.equal(overlay.transform, 'none')
        }
        console.log(
          'OVERLAY',
          width,
          reducedMotion,
          JSON.stringify(overlay.rect)
        )
        assert.equal(await dialog.getByRole('radio').count(), 3)
        const delays = await dialog
          .locator('label')
          .evaluateAll((es) =>
            es.map((e) => getComputedStyle(e).animationDelay)
          )
        assert.deepEqual(
          delays,
          reducedMotion === 'reduce'
            ? ['0s', '0s', '0s']
            : ['0.16s', '0.22s', '0.28s']
        )
        const backgroundY = await p.evaluate(() => window.scrollY)
        const controlWidth = (
          await p.locator('[data-fixed-controls]').boundingBox()
        ).width
        await p.mouse.move(4, 4)
        await p.mouse.wheel(0, 300)
        await p.waitForTimeout(100)
        assert.equal(
          await p.evaluate(() => window.scrollY),
          backgroundY,
          'background scroll locked'
        )
        assert.equal(
          (await p.locator('[data-fixed-controls]').boundingBox()).width,
          controlWidth,
          'no horizontal jump'
        )

        assert(
          await dialog.getByRole('radio', { name: /^3 Months/ }).isChecked()
        )
        await dialog.locator('label:has(input[value="1-month"])').click()
        await dialog
          .getByRole('radio', { name: /^1 Month/ })
          .press('ArrowRight')
        assert(
          await dialog.getByRole('radio', { name: /^3 Months/ }).isChecked()
        )
        const boxes = await dialog
          .getByRole('radio')
          .evaluateAll((es) =>
            es.map((e) => e.parentElement.getBoundingClientRect().toJSON())
          )
        assert(
          width < 640 ? boxes[0].y < boxes[1].y : boxes[0].y === boxes[1].y,
          'responsive plan columns'
        )
        assert(
          boxes.every((b) => b.height >= 320),
          'substantial cards'
        )
        if (width >= 640)
          assert(
            boxes.every(
              (b) =>
                Math.abs(b.height - boxes[0].height) < 1 &&
                Math.abs(b.width - boxes[0].width) < 1
            ),
            'equal card dimensions'
          )
        const cardTexts = await dialog.locator('label').allTextContents()
        assert(
          cardTexts[0].includes('Shop discovery') &&
            !cardTexts[0].includes('Shop Analytics')
        )
        assert(
          cardTexts[1].includes('Shop Analytics') &&
            !cardTexts[1].includes('Optimized Promotion')
        )
        assert(cardTexts[2].includes('Optimized Promotion'))
        for (const text of [
          'CA$9.90 / month',
          'CA$6.97 / month',
          'CA$5.48 / month',
          'Save CA$8.80',
          'Save CA$26.50',
        ])
          assert((await dialog.textContent()).includes(text))
        assert(
          await dialog.evaluate((el) => {
            const p = el.querySelector('[data-shop-pro-pricing]')
            const r = p.getBoundingClientRect()
            const b = p.querySelector('footer button').getBoundingClientRect()
            return Math.abs(r.right - b.right) < 1 && b.width < r.width - 60
          }),
          'sheet Continue right aligned'
        )
        assert(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth))
        assert(
          await dialog.evaluate(
            (el) =>
              Array.from(el.querySelectorAll('*')).filter(
                (n) =>
                  ['auto', 'scroll'].includes(getComputedStyle(n).overflowY) &&
                  n.scrollHeight > n.clientHeight
              ).length <= 1
          ),
          'one internal scroll owner'
        )
        if (reducedMotion === 'reduce' && [390, 1280].includes(width))
          await p.screenshot({
            path: 'tests/artifacts/shop-pro-pricing-sheet-' + width + '.png',
          })
        await dialog
          .getByRole('button', { name: 'Continue', exact: true })
          .click()
        assert.equal(await dialog.count(), 1)
        assert.deepEqual(await p.evaluate(() => window.requests), [])
        await dialog
          .getByRole('button', { name: 'Close Shop Pro pricing' })
          .focus()
        await p.keyboard.press('Shift+Tab')
        assert(
          await dialog.evaluate(
            (el) =>
              el.contains(document.activeElement) ||
              document.activeElement === document.body
          ),
          'focus stays in sheet'
        )
        await p.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        await p.waitForTimeout(220)
        assert(
          await opener.evaluate((e) => document.activeElement === e),
          'focus return'
        )
        const before = await p
          .getByRole('region', { name: 'Shop directory', exact: true })
          .boundingBox()
        await banner
          .getByRole('button', { name: 'Dismiss Shop Pro promotion' })
          .click()
        await banner.waitFor({ state: 'hidden' })
        const after = await p
          .getByRole('region', { name: 'Shop directory', exact: true })
          .boundingBox()
        assert(after.y < before.y, 'content moves upward')
        await p.evaluate(() => window.show('inline'))
        const inline = p.locator('[data-shop-listing-workspace]:visible')
        await inline.locator('[data-shop-pro-pricing]').waitFor()
        assert(
          await inline
            .locator('label')
            .evaluateAll((es) =>
              es.every((e) => getComputedStyle(e).animationName === 'none')
            ),
          'inline has no sheet stagger'
        )
        assert.equal(await p.getByRole('dialog').count(), 0)
        assert.equal(
          await p
            .getByRole('complementary', { name: 'Shop Pro promotion' })
            .count(),
          0
        )
        const geometry = await inline.evaluate((el) => {
          const rect = (e) => e.getBoundingClientRect().toJSON()
          const main = el.parentElement
          const pricing = el.querySelector('[data-shop-pro-pricing]')
          const css = getComputedStyle(main)
          const box = rect(main)
          const contentLeft = box.left + parseFloat(css.paddingLeft)
          const contentRight =
            box.left + main.clientWidth - parseFloat(css.paddingRight)
          const title =
            main.querySelector('[data-home-section-header] h2') ||
            main.previousElementSibling.querySelector('h1')
          return {
            main: box,
            workspace: rect(el),
            pricing: rect(pricing),
            title: rect(title),
            cards: [...el.querySelectorAll('label')].map(rect),
            footer: rect(el.querySelector('footer')),
            continue: rect(el.querySelector('footer button')),
            contentLeft,
            contentRight,
            background: getComputedStyle(pricing).backgroundColor,
            outer: getComputedStyle(el).backgroundColor,
          }
        })
        assert(
          Math.abs(
            (geometry.workspace.left + geometry.workspace.right) / 2 -
              (geometry.contentLeft + geometry.contentRight) / 2
          ) < 1,
          'centered in post-sidebar workspace'
        )
        assert(
          Math.abs(geometry.title.x - geometry.contentLeft) < 1,
          'page title uses Home shell inset'
        )
        assert(
          Math.abs(geometry.cards[0].x - geometry.pricing.x) < 1,
          'card baseline'
        )
        assert(
          Math.abs(geometry.footer.x - geometry.pricing.x) < 1,
          'footer baseline'
        )
        assert(
          Math.abs(geometry.continue.right - geometry.pricing.right) < 1,
          'Home Continue lower-right'
        )
        assert.equal(geometry.background, 'rgba(0, 0, 0, 0)')
        assert.equal(geometry.outer, 'rgba(0, 0, 0, 0)')
        assert.equal(await inline.locator('[data-shop-pro-badge]').count(), 0)
        assert.equal(
          await p
            .getByRole('heading', { name: 'My Shop', exact: true })
            .count(),
          1,
          'one visible page heading, no inner duplicate'
        )
        console.log(
          'HOME',
          width,
          JSON.stringify({
            x: geometry.workspace.x,
            width: geometry.workspace.width,
            card: geometry.cards[0].width,
            height: geometry.cards[0].height,
          })
        )
        if (reducedMotion === 'reduce')
          await p.screenshot({
            path: 'tests/artifacts/shop-pro-pricing-home-' + width + '.png',
          })
        if (width >= 1024) {
          await p
            .getByRole('button', { name: 'Keep expanded', exact: true })
            .click()
          await p.waitForTimeout(350)
          const pinned = await inline.evaluate((el) => {
            const main = el.parentElement,
              css = getComputedStyle(main),
              r = main.getBoundingClientRect(),
              b = el.getBoundingClientRect()
            return {
              left: r.left,
              center: (b.left + b.right) / 2,
              expected:
                (r.left +
                  parseFloat(css.paddingLeft) +
                  r.left +
                  main.clientWidth -
                  parseFloat(css.paddingRight)) /
                2,
              title: main
                .querySelector('[data-home-section-header]')
                .getBoundingClientRect().x,
              x: b.x,
            }
          })
          assert(
            pinned.left > geometry.main.left + 170,
            'pinned sidebar reserves actual workspace'
          )
          assert(
            Math.abs(pinned.center - pinned.expected) < 1,
            'pricing centers after pinned sidebar'
          )
          assert(
            Math.abs(pinned.title - (pinned.left + 24)) < 1,
            'title follows shared Home shell inset'
          )
        }
        await inline.locator('label').filter({ hasText: '6 Months' }).click()
        await inline
          .getByRole('button', { name: 'Continue', exact: true })
          .click()
        assert(
          await inline.getByRole('radio', { name: /^6 Months/ }).isChecked()
        )
        assert.equal(
          await inline
            .getByRole('button', { name: 'Create Shop Listing', exact: true })
            .count(),
          0
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        assert.equal(network, 0)
        assert.deepEqual(errors, [])
        assert.deepEqual(await p.evaluate(() => window.requests), [])
        await p.setViewportSize({ width, height: 560 })
        await p.evaluate(() => window.show('market'))
        await p.getByRole('button', { name: 'Shop', exact: true }).click()
        await p
          .getByRole('button', { name: 'Explore Shop Pro', exact: true })
          .click()
        await dialog.waitFor()
        await p.waitForTimeout(450)
        const shortBox = await dialog.boundingBox()
        assert(
          shortBox.y >= 0 && shortBox.y + shortBox.height <= 561,
          'short viewport no clipping'
        )
        if (width >= 640)
          assert(
            Math.abs(shortBox.y + shortBox.height / 2 - 280) < 1,
            'short wide dialog centered'
          )
        else
          assert(
            Math.abs(shortBox.y + shortBox.height - 560) < 1,
            'short mobile bottom attached'
          )
        assert(
          await dialog
            .getByRole('button', { name: 'Close Shop Pro pricing' })
            .isVisible()
        )
        await dialog
          .getByRole('button', { name: 'Continue', exact: true })
          .scrollIntoViewIfNeeded()
        assert(
          await dialog
            .getByRole('button', { name: 'Continue', exact: true })
            .isVisible()
        )
        await p.keyboard.press('Escape')
        await dialog.waitFor({ state: 'hidden' })
        assert(
          await p.evaluate(
            () =>
              document.documentElement.style.overflow !== 'hidden' &&
              document.body.style.overflow !== 'hidden'
          ),
          'scroll cleanup'
        )
        if (reducedMotion === 'reduce') assert.equal(await inline.count(), 0)
        await p.close()
        console.log(
          'PASS',
          width,
          reducedMotion,
          'Shop-only banner, sheet/inline shared plans, selection/keyboard/no-op, responsive/short-screen fit, focus/Escape/scroll cleanup, no requests'
        )
      }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
