/* global window, document, getComputedStyle, innerWidth, PointerEvent */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from 'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{ShopDirectory}from'@/components/shops/shop-directory';import{MarketFeedViewport}from'@/components/listings/market-feed-viewport';window.actions=[];function App(){const [mode,setMode]=React.useState('resale');window.shopMode=setMode;return <LazyMotion features={domAnimation}><header style={{height:72}}>Shop navigation</header><main style={{padding:'0 24px',maxWidth:1536,margin:'auto'}}><MarketFeedViewport mode={mode} resale={<p>Resale fixture</p>} shop={<ShopDirectory/>}/><footer style={{height:1000}}>End of fixture</footer></main></LazyMotion>};createRoot(document.getElementById('root')).render(<App/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:#fafafa;font-family:Arial}</style><div id="root"></div><script>window.process={env:{}}</script><script src="bundle.js"></script>'
)
async function main() {
  await build(aliases)
  for (const file of ['entry.tsx', 'api.ts'])
    fs.unlinkSync(path.join(root, file))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of process.env.TEST_WIDTH
      ? [Number(process.env.TEST_WIDTH)]
      : [390, 430, 820, 1280, 1536])
      for (const reduced of [false, true]) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          hasTouch: true,
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        p.setDefaultTimeout(8000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const u = new URL(r.request().url())
          assert.equal(u.origin, 'http://localhost:4177')
          return r.fulfill({
            path:
              u.pathname === '/'
                ? path.join(root, 'index.html')
                : u.pathname === '/bundle.js'
                ? path.join(root, 'bundle.js')
                : 'public' + u.pathname,
          })
        })
        await p.goto('http://localhost:4177/')
        await p.evaluate(() => window.shopMode('shop'))
        const slider = p.locator('[data-overlapping-slider]'),
          viewport = slider.locator('[class*="_viewport"]'),
          track = slider.locator('[class*="_track"]')
        await slider.waitFor()
        await p.waitForTimeout(550)
        await viewport.scrollIntoViewIfNeeded()
        await p.waitForTimeout(80)
        await p.clock.install()
        await p.clock.pauseAt(new Date())
        const run = (ms) => p.clock.runFor(ms)
        const phase = () => track.evaluate((n) => Number(n.dataset.phase))
        const canonical = slider.locator('[data-slider-copy="0"]')
        assert.deepEqual(await canonical.locator('h3').allTextContents(), [
          'Luna Studio',
          'Maple Corner',
          'Campus Tech',
          'Second Story',
          'Studio Thread',
        ])
        assert.equal(
          await slider
            .getByRole('button', { name: /^(Previous|Next) shop$/ })
            .count(),
          0
        )
        assert.equal(await slider.locator('[aria-live]').count(), 0)
        assert.equal(await canonical.count(), 5)
        assert(
          await slider
            .locator('[data-slider-copy]:not([data-slider-copy="0"]) > div')
            .evaluateAll((nodes) =>
              nodes.every(
                (node) =>
                  node.inert && node.getAttribute('aria-hidden') === 'true'
              )
            ),
          'visual copies never duplicate accessible controls'
        )
        assert(
          await viewport.evaluate((n) =>
            getComputedStyle(n).maskImage.includes('linear-gradient')
          )
        )
        const vp = await viewport.boundingBox(),
          shell = await slider.boundingBox()
        assert(vp.x >= 0 && vp.x + vp.width <= width + 1)
        assert(vp.width > shell.width, 'edge bleed preserved')
        const original = await phase()
        await run(1000)
        const moved = await phase()
        assert(
          reduced
            ? Math.abs(moved - original) < 0.01
            : moved - original > 22 && moved - original < 25,
          'linear 24px/s, or stationary reduced motion ' +
            JSON.stringify({ original, moved })
        )
        // Manual movement is free, circular, and never mistaken for a card click.
        const drag = async (dx, touch = false) => {
          const image = slider
            .locator('[data-active="true"] article > div')
            .first()
          await image.scrollIntoViewIfNeeded()
          const box = await image.boundingBox(),
            x = box.x + box.width * 0.5,
            y = box.y + box.height * 0.6
          if (touch) {
            const cdp = await p.context().newCDPSession(p)
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [{ x, y }],
            })
            await run(32)
            for (let i = 1; i <= 8; i++) {
              await cdp.send('Input.dispatchTouchEvent', {
                type: 'touchMove',
                touchPoints: [{ x: x + (dx * i) / 8, y }],
              })
              await run(32)
            }
            await cdp.send('Input.dispatchTouchEvent', {
              type: 'touchEnd',
              touchPoints: [],
            })
            await cdp.detach()
          } else {
            await p.mouse.move(x, y)
            await p.mouse.down()
            await p.mouse.move(x + dx, y, { steps: 8 })
            await p.mouse.up()
          }
        }
        const beforeDrag = await phase()
        await drag(-90)
        const afterDrag = await phase()
        assert(afterDrag > beforeDrag + 80, 'mouse drag controls position')
        await run(4900)
        assert(
          Math.abs((await phase()) - afterDrag) < 0.01,
          'paused for first 4.9 seconds'
        )
        // A second interaction restarts the entire delay.
        await drag(40)
        const again = await phase()
        await run(4900)
        assert(Math.abs((await phase()) - again) < 0.01)
        await run(400)
        assert(
          reduced
            ? Math.abs((await phase()) - again) < 0.01
            : (await phase()) > again + 5,
          'resume after five seconds without snap'
        )
        const beforeTouch = await phase()
        await drag(-80, true)
        assert(
          (await phase()) > beforeTouch + 60,
          'real touch swipe works ' +
            JSON.stringify({ beforeTouch, after: await phase() })
        )
        await run(5100)
        // Keyboard navigation remains available in reduced motion; Home exposes Luna.
        await viewport.focus()
        await p.keyboard.press('Home')
        const frozen = await phase()
        assert(Math.abs(frozen) < 0.01)
        const luna = canonical.filter({
          has: p.getByRole('heading', { name: 'Luna Studio', exact: true }),
        })
        const heart = luna.getByRole('button', {
          name: 'Favorite demo shop: Luna Studio',
          exact: true,
        })
        await heart.click()
        await run(700)
        assert.equal(
          await luna
            .getByRole('button', {
              name: 'Unfavorite demo shop: Luna Studio',
              exact: true,
            })
            .getAttribute('aria-pressed'),
          'true'
        )
        await luna
          .getByRole('button', {
            name: 'Go to Luna Studio demo shop',
            exact: true,
          })
          .click()
        await run(1800)
        await p.locator('[data-shop-detail-demo]').waitFor()
        const saved = await phase()
        await run(9000)
        assert(
          Math.abs((await phase()) - saved) < 0.01,
          'hidden directory stays paused'
        )
        await p
          .getByRole('button', { name: 'Back to shop list', exact: true })
          .click()
        await run(300)
        assert(
          Math.abs((await phase()) - saved) < (reduced ? 0.01 : 8),
          'return preserves circular position ' +
            JSON.stringify({ saved, current: await phase() })
        )
        // Remove keyboard focus and restart from present position after the grace period.
        await p.evaluate(() => document.activeElement.blur())
        await run(5200)
        // Traverse complete circles with the same position renderer, then let
        // real autoplay cross a seam. This avoids waiting real minutes per width.
        await viewport.focus()
        await p.keyboard.press('Home')
        await luna.locator('img').scrollIntoViewIfNeeded()
        const cycle = await track.evaluate((node) => Number(node.dataset.cycle))
        await run(32)
        const box = await luna.locator('img').boundingBox(),
          startX = box.x + box.width * 0.5,
          y = box.y + box.height * 0.6
        await p.mouse.move(startX, y)
        await p.mouse.down()
        await p.mouse.move(startX - 10, y)
        const continuity = await viewport.evaluate(
          (node, { startX, y, cycle }) => {
            const vp = node.getBoundingClientRect(),
              track = node.querySelector('[class*="_track"]')
            const seen = new Set(),
              prior = new Map()
            let maxJump = 0,
              wraps = 0,
              last = Number(track.dataset.phase)
            for (let travel = 11; travel <= cycle * 2 + 10; travel++) {
              node.dispatchEvent(
                new PointerEvent('pointermove', {
                  bubbles: true,
                  pointerId: 1,
                  clientX: startX - travel,
                  clientY: y,
                })
              )
              const phase = Number(track.dataset.phase)
              if (phase < last - 100) wraps++
              last = phase
              for (const card of track.children) {
                const r = card.getBoundingClientRect(),
                  key = card.dataset.sliderIndex + ':' + card.dataset.sliderCopy
                const visible = r.right > vp.left + 20 && r.left < vp.right - 20
                if (visible) seen.add(card.dataset.sliderIndex)
                const old = prior.get(key)
                if (old?.visible && visible)
                  maxJump = Math.max(maxJump, Math.abs(r.left - old.x))
                prior.set(key, { visible, x: r.left })
              }
            }
            // Finish twelve pixels before the automatic wrap.
            node.dispatchEvent(
              new PointerEvent('pointermove', {
                bubbles: true,
                pointerId: 1,
                clientX: startX - cycle + 12,
                clientY: y,
              })
            )
            return { maxJump, wraps, seen: [...seen] }
          },
          { startX, y, cycle }
        )
        await p.mouse.up()
        assert.equal(continuity.wraps, 2)
        assert(
          continuity.maxJump < 2,
          'no visible seam/blank/reset ' + JSON.stringify(continuity)
        )
        assert.equal(continuity.seen.length, 5)
        await p.evaluate(() => document.activeElement.blur())
        await run(4900)
        assert(Math.abs((await phase()) - (cycle - 12)) < 0.01)
        await run(1100)
        assert(
          reduced
            ? Math.abs((await phase()) - (cycle - 12)) < 0.01
            : (await phase()) < 24,
          'autoplay crosses last-to-first seam continuously'
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          ),
          'no horizontal overflow'
        )
        assert.deepEqual(errors, [])
        await p.screenshot({
          path: path.join(root, `shop-auto-carousel-${width}-${reduced}.png`),
          fullPage: true,
        })
        console.log(
          'PASS Shop carousel',
          width,
          'reduced=' + reduced,
          '24px/s; mouse/touch; 5s restart/resume; Favorite; detail/back; geometry/fade/overflow'
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
