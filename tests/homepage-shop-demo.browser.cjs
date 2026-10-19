const { TEST_PICTURES } = require('../scripts/lib/test-pictures.cjs')
/* global window,document,getComputedStyle */
// Real landing demo components and ShopCard; local fixtures/static image only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'landing-link.tsx'),
  `import React from 'react';export const Link=props=><a {...props}/>;`
)
aliases['@ui/link/link'] = path.join(root, 'landing-link.tsx')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {HomepageListingDemo} from '@/components/listings/homepage-listing-demo';import {HomepageShopDemo} from '@/components/listings/homepage-shop-demo';import {HomepageFooter} from '@/components/listings/homepage-footer';import {ShopCard} from '@/components/shops/shop-card';import {homepageShopDemo} from '@/lib/fixtures/homepage-shop-demo';
window.actions=[];window.requests=[];const root=createRoot(document.getElementById('root'));window.showRealShop=()=>root.render(<LazyMotion features={domAnimation}><div style={{width:400}}><ShopCard shop={homepageShopDemo}/></div></LazyMotion>);root.render(<LazyMotion features={domAnimation}><HomepageListingDemo/><HomepageShopDemo/><HomepageFooter/></LazyMotion>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#fff;font-family:Arial}html{scrollbar-gutter:stable}</style><div id="root"></div><script src="bundle.js"></script>'
)
const scene = fs.readFileSync('components/listings/homepage-scene.tsx', 'utf8')
assert(
  scene.indexOf('<HomepageListingDemo />') <
    scene.indexOf('<HomepageShopDemo />')
)
assert(
  scene.indexOf('<HomepageShopDemo />') < scene.indexOf('<HomepageFooter />')
)
;(async () => {
  await build(aliases)
  fs.unlinkSync(path.join(root, 'entry.tsx'))
  fs.unlinkSync(path.join(root, 'landing-link.tsx'))
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
        const errors = []
        let unexpected = 0
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const u = new URL(r.request().url())
          if (u.origin === 'http://localhost:4177') {
            if (u.pathname === '/bundle.js')
              return r.fulfill({
                path: path.join(root, 'bundle.js'),
                contentType: 'application/javascript',
              })
            if (u.pathname === TEST_PICTURES.chair)
              return r.fulfill({
                path: 'public' + TEST_PICTURES.chair,
                contentType: 'image/webp',
              })
            if (u.pathname === '/')
              return r.fulfill({
                path: path.join(root, 'index.html'),
                contentType: 'text/html',
              })
          }
          unexpected++
          return r.abort()
        })
        await p.goto('http://localhost:4177/')
        const listing = p.locator('[data-home-section="listing-demo"]'),
          shop = p.locator('[data-home-section="shop-demo"]')
        await shop.scrollIntoViewIfNeeded()
        await p.waitForTimeout(850)
        assert.equal(
          await listing.locator('h2').textContent(),
          'Take a closer look. Then connect with the seller.'
        )
        assert.equal(
          await shop.locator('h2').textContent(),
          'Build your business. Then grow your own shop.'
        )
        assert.equal(
          await shop.locator('header p').textContent(),
          'Create a storefront, organize your listings, and show how Shop helps sellers grow beyond everyday resale.'
        )
        assert(
          await shop.evaluate(
            (el) =>
              el.previousElementSibling?.getAttribute('data-home-section') ===
                'listing-demo' && el.nextElementSibling?.tagName === 'FOOTER'
          ),
          'new section directly below listing demo, above footer'
        )
        assert.equal(await shop.locator('[data-shop-pro-badge]').count(), 1)
        assert((await shop.textContent()).includes('Home & Living'))
        assert(
          (await shop.textContent()).includes(
            'Curated home finds, decor, and small lifestyle pieces for student spaces.'
          )
        )
        assert.equal(await shop.locator('video,iframe,a').count(), 0)
        assert.equal(
          await shop.getByRole('button').count(),
          1,
          'one real Shop card, no subscription/playback CTA'
        )
        assert(
          !/CA\$|Subscribe|Continue|9\.90/.test(await shop.textContent()),
          'no resale price or pricing'
        )
        const geometry = await shop.evaluate((el) => {
          const rect = (e) => e.getBoundingClientRect().toJSON()
          return {
            section: rect(el),
            previous: rect(el.previousElementSibling),
            card: rect(el.querySelector('[data-demo-enter="card"]')),
            video: rect(el.querySelector('[data-demo-enter="video"]')),
            slot: rect(
              el.querySelector(
                '[aria-label="Create Shop Demo video placeholder"]'
              )
            ),
            heading: rect(el.querySelector('header')),
            caption: el.querySelector('[data-demo-enter="video"]').textContent,
            opacity: [...el.querySelectorAll('[data-demo-enter]')].map(
              (e) => getComputedStyle(e).opacity
            ),
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          }
        })
        assert.equal(geometry.section.x, geometry.previous.x)
        assert.equal(geometry.section.width, geometry.previous.width)
        assert(!geometry.overflow)
        assert(
          Math.abs(geometry.slot.width / geometry.slot.height - 16 / 9) < 0.01
        )
        assert(geometry.caption.includes('Tutorial video coming soon.'))
        if (width < 768)
          assert(
            geometry.video.y >= geometry.card.bottom + 35,
            'mobile card first, placeholder second'
          )
        else {
          assert(geometry.video.x > geometry.card.right, 'desktop columns')
          assert(
            Math.abs(
              geometry.video.y +
                geometry.video.height / 2 -
                geometry.card.y -
                geometry.card.height / 2
            ) < 1,
            'placeholder vertically aligned with card'
          )
        }
        if (reducedMotion === 'reduce')
          assert(
            geometry.opacity.every((v) => +v === 1),
            'reduced motion visible'
          )
        if (reducedMotion === 'reduce')
          await shop.screenshot({
            path: 'tests/artifacts/homepage-shop-demo-' + width + '.png',
          })
        await shop
          .getByRole('button', { name: 'Open shop: Maple Corner', exact: true })
          .click()
        const dialog = p.getByRole('dialog', {
          name: 'Maple Corner',
          exact: true,
        })
        await dialog.waitFor()
        assert.equal(
          await dialog.getByRole('link').count(),
          0,
          'demo has no fictional Shop navigation'
        )
        assert.equal(
          await dialog
            .getByRole('button', { name: 'View Shop', exact: true })
            .count(),
          0
        )
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'hidden' })
        assert.equal(new URL(p.url()).pathname, '/')
        assert.equal(unexpected, 0)
        assert.deepEqual(errors, [])
        if (width === 1280 && reducedMotion === 'reduce') {
          await p.evaluate(() => window.showRealShop())
          await p
            .getByRole('button', {
              name: 'Open shop: Maple Corner',
              exact: true,
            })
            .click()
          const real = p.getByRole('dialog', {
            name: 'Maple Corner',
            exact: true,
          })
          await real.waitFor()
          assert.equal(
            await real
              .getByRole('link', { name: 'View Shop', exact: true })
              .getAttribute('href'),
            '/shop/maple_corner_demo',
            'normal ShopCard keeps existing public navigation'
          )
        }
        console.log(
          'PASS',
          width,
          reducedMotion,
          'preserved listing demo, shared ShopCard/layout/placeholder, responsive alignment, local expand/close, no routing/API'
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
