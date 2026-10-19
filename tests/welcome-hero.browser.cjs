/* global window, document, getComputedStyle, requestAnimationFrame */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'hero-link.jsx'),
  `import React from 'react';export const Link=props=><a {...props}/>;`
)
aliases['@ui/link/link'] = path.join(root, 'hero-link.jsx')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import '@/components/ui/MaskedHeading.css';import '@/components/ui/TextType.css';import React from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{WelcomeHero}from'@/components/listings/welcome-hero';import parallax from '@/components/ui/hero-parallax.module.css';import scene from '@/components/listings/homepage-scene.module.css';function App(){const[n,set]=React.useState(0);window.rerender=()=>set(v=>v+1);return <LazyMotion features={domAnimation}><div className={parallax.root+' '+scene.parallax} data-renders={n} style={{'--hero-height':'900px'}}><WelcomeHero visual={<div data-ticket-placeholder>Existing visual slot</div>}/><div data-after-hero>Next section</div></div></LazyMotion>}createRoot(document.getElementById('root')).render(<App/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:white;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
const line1 = 'Buy and sell second-hand items within the',
  line2 = 'Western community.'
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
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reduced of [false, true]) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
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
          if (u.pathname.startsWith('/static/'))
            return r.fulfill({ path: 'public' + u.pathname })
          if (u.pathname.endsWith('.js'))
            return r.fulfill({
              path: path.join(root, path.basename(u.pathname)),
              contentType: 'application/javascript',
            })
          throw Error('Unexpected request ' + u.pathname)
        })
        await p.goto('http://localhost:4177/')
        const subtitle = p.locator(
            '[aria-label="' + line1 + ' ' + line2 + '"]'
          ),
          text = subtitle.locator('[class*="_subtitleText"]'),
          lines = text.locator(':scope > span')
        await subtitle.waitFor()
        await p.waitForFunction(() => typeof window.rerender === 'function')
        if (!reduced) {
          await text.locator('.text-type__content').waitFor()
          await p.evaluate(() => {
            window.typeSamples = []
            window.sampleTyping = true
            function sample() {
              const block = document.querySelector('[class*="_subtitleText"]')
              if (block) {
                const lines = block.children,
                  box = block.parentElement.getBoundingClientRect()
                window.typeSamples.push({
                  first: lines[0].textContent,
                  second: lines[1].textContent,
                  height: box.height,
                  after: document
                    .querySelector('[data-after-hero]')
                    .getBoundingClientRect().y,
                })
              }
              if (window.sampleTyping) requestAnimationFrame(sample)
            }
            sample()
          })
          await p.waitForTimeout(300)
          const before = await lines.first().textContent()
          await p.evaluate(() => window.rerender())
          await p.setViewportSize({ width: width + 4, height: 1000 })
          await p.waitForTimeout(50)
          assert(
            (await lines.first().textContent()).length >= before.length,
            'ordinary rerender/resize does not reset'
          )
          await p.setViewportSize({ width, height: 1000 })
        }
        await p.waitForFunction(
          ({ line1, line2 }) => {
            const block = document.querySelector('[class*="_subtitleText"]')
            return (
              block?.children[0]?.textContent === line1 &&
              block?.children[1]?.textContent === line2
            )
          },
          { line1, line2 }
        )
        await p.evaluate(() => (window.sampleTyping = false))
        if (!reduced) {
          const samples = await p.evaluate(() => window.typeSamples)
          assert(
            samples.some(
              (s) =>
                s.first.length > 0 && s.first.length < line1.length && !s.second
            )
          )
          assert(
            samples.some(
              (s) => s.second.length > 0 && s.second.length < line2.length
            )
          )
          assert(
            samples.every((s) => !s.second || s.first === line1),
            'line 2 waits for full line 1'
          )
          assert(
            Math.max(...samples.map((s) => s.height)) -
              Math.min(...samples.map((s) => s.height)) <
              1,
            'reserved subtitle height stable'
          )
          assert(
            Math.max(...samples.map((s) => s.after)) -
              Math.min(...samples.map((s) => s.after)) <
              1,
            'following content does not move'
          )
        }
        assert.equal(
          await text.locator('.text-type__cursor').count(),
          0,
          'existing hidden cursor preserved'
        )
        const boxes = await lines.evaluateAll((nodes) =>
          nodes.map((n) => {
            const r = n.getBoundingClientRect()
            return {
              x: r.x,
              y: r.y,
              w: r.width,
              h: r.height,
              lineHeight: parseFloat(getComputedStyle(n).lineHeight),
            }
          })
        )
        assert(Math.abs(boxes[0].x - boxes[1].x) < 0.5)
        assert(
          boxes.every((b) => Math.abs(b.h - b.lineHeight) < 1),
          'each intentional line fits one row'
        )
        const brand = p.getByRole('link', { name: 'Usual & Unusual' }),
          logo = brand.locator('img'),
          login = p.getByRole('button', { name: 'Log in', exact: true })
        await logo.evaluate((img) => img.decode())
        assert.equal(
          await logo.getAttribute('src'),
          '/static/icons/uu-logo.svg'
        )
        const lb = await logo.boundingBox(),
          bb = await brand.boundingBox(),
          loginBox = await login.boundingBox()
        assert(
          bb.x + bb.width <= loginBox.x,
          'brand does not collide with Login'
        )
        assert(lb.x < bb.x + bb.width / 2)
        assert(Math.abs(lb.y + lb.height / 2 - bb.y - bb.height / 2) < 1)
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          'no horizontal overflow ' +
            JSON.stringify(
              await p.evaluate(() => ({
                doc: document.documentElement.scrollWidth,
                width: window.innerWidth,
                offenders: [...document.querySelectorAll('body *')]
                  .map((e) => ({
                    tag: e.tagName,
                    cls: e.className,
                    r: e.getBoundingClientRect().right,
                  }))
                  .filter((e) => e.r > window.innerWidth + 1)
                  .slice(0, 12),
              }))
            )
        )
        assert.equal(
          await p.locator('h1').getAttribute('aria-label'),
          'Find it nearby. Pass it on.'
        )
        assert.deepEqual(errors, [])
        assert.equal(network, 0)
        console.log(
          'PASS Welcome hero',
          width,
          'reduced=' + reduced,
          JSON.stringify({ logoHeight: lb.height, lines: boxes })
        )
        await p.screenshot({
          path: path.join(root, `welcome-hero-${width}-${reduced}.png`),
        })
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
