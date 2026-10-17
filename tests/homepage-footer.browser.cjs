/* global document,window,getComputedStyle */
// Offline public footer: real component/styles, no authentication, API or data.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import React from 'react';import {createRoot} from 'react-dom/client';import {HomepageFooter} from '@/components/listings/homepage-footer';
createRoot(document.getElementById('root')).render(<><main style={{height:128,background:'#0b0b0b',color:'#fff',padding:24}}>Welcome to Usual & Unusual</main><HomepageFooter/></>);
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;font-family:Arial}html{scrollbar-gutter:stable}</style><div id="root"></div><script src="bundle.js"></script>'
)
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
        const errors = []
        let network = 0
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => {
          network++
          return r.abort()
        })
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        const footer = p.getByRole('contentinfo', {
          name: 'About Usual & Unusual',
        })
        await footer.waitFor()
        assert.equal(await p.locator('footer').count(), 1)
        assert.equal(
          await footer.locator('button,a,[role="tab"],ol').count(),
          0,
          'static editorial footer, no tabs/links/numbered legacy sections'
        )
        assert.deepEqual(await footer.locator('h2').allTextContents(), [
          'Features',
          'Why UU',
          'Safety & Trust',
          'Contact',
        ])
        const contact = footer.getByRole('region', {
          name: 'Contact',
          exact: true,
        })
        assert.equal(
          (await contact.textContent()).trim(),
          'Contact',
          'Contact deliberately empty'
        )
        assert.equal(await footer.locator('dt').count(), 16)
        const text = await footer.textContent()
        for (const copy of [
          'A private marketplace built for the Western student community.',
          'Payment method setup and seller payout onboarding are handled through Stripe.',
          'Independent project for the Western community.',
          'Not affiliated with Western University.',
          '\u00a9 2026 Usual & Unusual',
        ])
          assert(text.includes(copy), copy)
        assert(
          !/24[ -]?(hour|hours)|coming soon|100%|fraud.free|guaranteed|regulatory|On Campus|\bStore\b|\bunique\b/i.test(
            text
          ),
          'no obsolete or unsupported claims'
        )
        const geometry = await footer.evaluate((el) => {
          const r = (e) => e.getBoundingClientRect().toJSON(),
            sections = [...el.querySelectorAll('section')],
            copyright = el.lastElementChild.lastElementChild.lastElementChild,
            legal = copyright.parentElement
          return {
            box: r(el),
            previous: r(el.previousElementSibling),
            previousColor: getComputedStyle(el.previousElementSibling)
              .backgroundColor,
            background: getComputedStyle(el).backgroundColor,
            color: getComputedStyle(el).color,
            backgroundImage: getComputedStyle(el).backgroundImage,
            filter: getComputedStyle(el).backdropFilter,
            sections: sections.map(r),
            copyright: r(copyright),
            legal: r(legal),
            disclaimer: r(legal.firstElementChild),
            descriptionSizes: [...el.querySelectorAll('dd')].map((e) =>
              parseFloat(getComputedStyle(e).fontSize)
            ),
            legalSize: parseFloat(getComputedStyle(legal).fontSize),
            last: el === document.getElementById('root').lastElementChild,
            overflow: document.documentElement.scrollWidth > window.innerWidth,
          }
        })
        assert.equal(geometry.background, 'rgb(250, 250, 248)')
        assert.equal(geometry.color, 'rgb(32, 32, 32)')
        assert.equal(geometry.previousColor, 'rgb(11, 11, 11)')
        assert.equal(geometry.backgroundImage, 'none')
        assert.equal(geometry.filter, 'none')
        assert(geometry.last)
        assert(!geometry.overflow)
        assert.equal(
          geometry.previous.bottom,
          geometry.box.top,
          'clean dark-to-white boundary'
        )
        if (width < 768) {
          assert(
            geometry.sections.every(
              (s, i) => i === 0 || s.y > geometry.sections[i - 1].bottom
            ),
            'mobile vertical stack'
          )
          assert(
            geometry.copyright.y >= geometry.disclaimer.bottom,
            'mobile legal stack'
          )
        } else if (width < 1100) {
          assert.equal(geometry.sections[0].y, geometry.sections[1].y)
          assert(
            geometry.sections[2].y > geometry.sections[0].bottom,
            'tablet two columns'
          )
        } else {
          assert(
            geometry.sections.every((s) => s.y === geometry.sections[0].y),
            'desktop four columns'
          )
          assert(
            Math.abs(geometry.copyright.right - geometry.legal.right) < 1,
            'legal copyright right aligned'
          )
        }
        assert(geometry.descriptionSizes.every((s) => s >= 14))
        assert(geometry.legalSize >= 13)
        assert.deepEqual(errors, [])
        assert.equal(network, 0)
        if (reducedMotion === 'reduce')
          await p.screenshot({
            path: 'tests/artifacts/homepage-footer-' + width + '.png',
            fullPage: true,
          })
        console.log(
          'PASS',
          width,
          reducedMotion,
          'white/dark editorial footer, 1/2/4 columns, empty Contact, legal alignment, no obsolete claims/overflow/requests'
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
