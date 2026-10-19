const { TEST_PICTURES } = require('../scripts/lib/test-pictures.cjs')
/* global window,document,getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {LazyMotion,domAnimation} from 'framer-motion';import {HomepageTransactionDemo,HomepageStudentSelling} from '@/components/listings/homepage-marketplace-story';import {HomepageFooter} from '@/components/listings/homepage-footer';createRoot(document.getElementById('root')).render(<LazyMotion features={domAnimation}><HomepageTransactionDemo/><HomepageStudentSelling/><HomepageFooter/></LazyMotion>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#fff;font-family:Arial}</style><div id="root"></div><script src="bundle.js"></script>'
)
const scene = fs.readFileSync('components/listings/homepage-scene.tsx', 'utf8')
const sequence = [
  'HomepageListingDemo',
  'HomepageShopDemo',
  'HomepageTransactionDemo',
  'HomepageStudentSelling',
  'HomepageFooter',
].map((x) => scene.indexOf('<' + x + ' />'))
assert(sequence.every((x, i) => x >= 0 && (!i || x > sequence[i - 1])))
;(async () => {
  await build()
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
        let network = 0
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const u = new URL(r.request().url())
          if (u.origin === 'http://localhost:4177') {
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
            if (u.pathname === TEST_PICTURES.chair)
              return r.fulfill({
                path: 'public' + TEST_PICTURES.chair,
                contentType: 'image/webp',
              })
          }
          network++
          return r.abort()
        })
        await p.goto('http://localhost:4177/')
        const section = p.locator('[data-home-section="transaction-demo"]'),
          tabs = section.getByRole('tab')
        assert.equal(await tabs.count(), 4)
        assert((await tabs.nth(0).getAttribute('aria-selected')) === 'true')
        for (const [index, name, expected] of [
          [0, 'Find', 'Browse Resale or discover Shops'],
          [1, 'Connect', 'Would you take CA$40?'],
          [2, 'Agree', 'Waiting for confirmation'],
          [3, 'Exchange', 'Meet / Inspect is current.'],
        ]) {
          await tabs.nth(index).click()
          const panel = section.getByRole('tabpanel', { name, exact: true })
          await panel
            .locator('[data-flow-preview="' + name.toLowerCase() + '"]')
            .waitFor()
          await p.waitForTimeout(380)
          assert((await panel.textContent()).includes(expected))
          assert.equal(await panel.locator('[data-flow-preview]').count(), 1)
          assert.equal(
            await panel.locator('button,a,input').count(),
            name === 'Find' ? 1 : name === 'Connect' ? 2 : 0,
            'only local demo Favorite / no-op real Offer controls'
          )
          if (name === 'Find') {
            const card = panel.locator('[data-listing-card-preview]')
            await card.waitFor()
            for (const text of [
              'CA$45',
              'Wooden accent chair',
              'Good \u00b7 Home & Living',
            ])
              assert((await card.textContent()).includes(text))
            assert.equal(
              await card
                .getByText('Resale \u00b7 Listing preview', { exact: true })
                .count(),
              0
            )
            const geometry = await card.evaluate((el) => {
              const media = el.firstElementChild.firstElementChild,
                r = media.getBoundingClientRect()
              return {
                width: r.width,
                height: r.height,
                radius: getComputedStyle(media).borderRadius,
                fit: getComputedStyle(media.querySelector('img')).objectFit,
                bg: getComputedStyle(el.firstElementChild).backgroundColor,
              }
            })
            assert(
              Math.abs(geometry.width - geometry.height) < 0.5,
              'Find image square'
            )
            assert(
              geometry.width <= 300,
              'Find does not stretch across preview'
            )
            assert.equal(geometry.radius, '16px')
            assert.equal(geometry.fit, 'cover')
            assert.equal(geometry.bg, 'rgba(0, 0, 0, 0)')
            const heart = card.getByRole('button', {
              name: 'Add to favorites',
              exact: true,
            })
            await heart.click()
            assert.equal(
              await card
                .getByRole('button', {
                  name: 'Remove from favorites',
                  exact: true,
                })
                .getAttribute('aria-pressed'),
              'true'
            )
            await p.waitForTimeout(650)
            await card
              .getByRole('button', {
                name: 'Remove from favorites',
                exact: true,
              })
              .focus()
            await p.keyboard.press('Space')
            assert.equal(
              await card
                .getByRole('button', { name: 'Add to favorites', exact: true })
                .getAttribute('aria-pressed'),
              'false'
            )
          }
          if (name === 'Connect') {
            const offer = panel.locator('[data-offer-id="welcome-offer"]')
            assert.equal(await offer.getAttribute('data-offer-own'), 'true')
            assert.equal(
              await offer.getAttribute('data-offer-status'),
              'Active'
            )
            assert((await offer.textContent()).includes('Buyer \u00b7 Offer'))
            assert((await offer.textContent()).includes('CA$40'))
            assert.equal(
              await offer.getByText('Pending', { exact: true }).count(),
              0
            )
            const visual = await offer.evaluate((el) => {
              const body = el.firstElementChild,
                status = el.querySelector(':scope > span'),
                r = body.getBoundingClientRect(),
                b = status.getBoundingClientRect()
              const conversation = el.parentElement.parentElement
              return {
                radius: getComputedStyle(body).borderRadius,
                bg: getComputedStyle(body).backgroundColor,
                blur: getComputedStyle(body, '::before').filter,
                statusBg: getComputedStyle(status).backgroundColor,
                gap: r.top - b.bottom,
                chatGap: getComputedStyle(conversation).gap,
                buyer: getComputedStyle(
                  conversation.children[1].querySelector('p')
                ).backgroundColor,
                seller: getComputedStyle(
                  conversation.lastElementChild.querySelector('p')
                ).backgroundColor,
              }
            })
            assert.equal(visual.radius, '16px')
            assert.equal(visual.bg, 'rgb(37, 99, 235)')
            assert.equal(visual.blur, 'blur(18px)')
            assert.equal(visual.statusBg, 'rgb(22, 101, 52)')
            assert(Math.abs(visual.gap - 4) < 0.5)
            assert.equal(visual.chatGap, '16px')
            assert.equal(visual.buyer, 'rgb(0, 122, 255)')
            assert.equal(visual.seller, 'rgb(119, 84, 151)')
            for (const button of await offer.getByRole('button').all())
              await button.click()
          }
          assert.equal(
            await p.getByRole('dialog').count(),
            0,
            'demo never opens live Listing / Offer flow'
          )
          assert.equal(
            await tabs.nth(index).getAttribute('aria-selected'),
            'true'
          )
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
          if (name === 'Exchange') {
            assert.equal(
              await panel.locator('[data-slot="stepper"]').count(),
              1
            )
            assert.equal(
              await panel
                .getByLabel('Payment: Completed', { exact: true })
                .count(),
              1
            )
            assert.equal(
              await panel
                .getByLabel('Meet / Inspect: Current', { exact: true })
                .count(),
              1
            )
            assert.equal(
              await panel
                .getByLabel('Completed: Inactive', { exact: true })
                .count(),
              1
            )
          }
          if (reducedMotion === 'reduce')
            await section.screenshot({
              path:
                'tests/artifacts/homepage-flow-' +
                width +
                '-' +
                name.toLowerCase() +
                '.png',
            })
        }
        await tabs.nth(3).focus()
        await p.keyboard.press('Home')
        await p.waitForTimeout(380)
        assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true')
        await p.keyboard.press('ArrowRight')
        await p.waitForTimeout(380)
        assert.equal(await tabs.nth(1).getAttribute('aria-selected'), 'true')
        assert(await tabs.nth(1).evaluate((e) => document.activeElement === e))
        await p.keyboard.press('End')
        await p.waitForTimeout(380)
        assert.equal(await tabs.nth(3).getAttribute('aria-selected'), 'true')
        await p.keyboard.press('ArrowRight')
        await p.waitForTimeout(380)
        assert.equal(await tabs.nth(0).getAttribute('aria-selected'), 'true')
        for (let i = 0; i < 12; i++) await tabs.nth(i % 4).click()
        await p.waitForTimeout(600)
        assert.equal(
          await section.locator('[data-flow-preview]').count(),
          1,
          'rapid switching never stacks previews'
        )
        const panel = section.getByRole('tabpanel')
        await tabs.nth(3).focus()
        await p.keyboard.press('Tab')
        assert(
          await panel.evaluate((e) => document.activeElement === e),
          'tabpanel keyboard reachable'
        )
        const geometry = await section.evaluate((el) => {
          const b = (e) => e.getBoundingClientRect().toJSON(),
            flow = el.querySelector('[data-flow-preview]')
          return {
            tabs: [...el.querySelectorAll('[role=tab]')].map(b),
            text: b(flow.firstElementChild),
            preview: b(flow.lastElementChild),
          }
        })
        if (width < 640)
          assert(
            geometry.tabs[2].y > geometry.tabs[0].y,
            'mobile compact 2x2 tabs'
          )
        else
          assert(
            geometry.tabs.every((b) => b.y === geometry.tabs[0].y),
            'wide horizontal process'
          )
        if (width < 768)
          assert(
            geometry.preview.y >= geometry.text.bottom,
            'mobile stacked explanation/preview'
          )
        else
          assert(
            geometry.preview.x > geometry.text.right,
            'wide balanced columns'
          )
        const selling = p.locator('[data-home-section="student-selling"]')
        assert.equal(await selling.locator('ol>li').count(), 3)
        assert.equal(await selling.locator('button,a').count(), 0)
        assert(
          (await selling.textContent()).includes(
            'Shop when selling becomes a business.'
          )
        )
        assert(
          await selling.evaluate(
            (el) => el.nextElementSibling.tagName === 'FOOTER'
          )
        )
        if (reducedMotion === 'reduce')
          await selling.screenshot({
            path: 'tests/artifacts/homepage-student-selling-' + width + '.png',
          })
        assert.equal(new URL(p.url()).pathname, '/')
        assert.equal(network, 0)
        assert.deepEqual(errors, [])
        console.log(
          'PASS',
          width,
          reducedMotion,
          '4 local stages, rapid switching/keyboard/tab semantics, static previews/shared OrderProgress, editorial section/footer order, no overflow/API'
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
