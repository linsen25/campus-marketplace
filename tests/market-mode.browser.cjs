/* global document, window, getComputedStyle, requestAnimationFrame, performance */
// Real local Marketplace UI, anonymous/read-only staging access; no fixture writes.
const assert = require('node:assert/strict')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')

async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const reduced of [false, true])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const context = await browser.newContext({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
          serviceWorkers: 'block',
        })
        let forbidden = 0
        await context.route(/yzvchumzyonegujucyqs[.]supabase[.]co/, (r) => {
          forbidden++
          return r.abort()
        })
        await context.route('**/api/auth/session', (r) =>
          r.fulfill({ json: { seller: null } })
        )
        const page = await context.newPage()
        const writes = []
        page.on('request', (r) => {
          if (
            r.method() !== 'GET' &&
            new URL(r.url()).origin === 'http://localhost:3000'
          )
            writes.push(new URL(r.url()).pathname)
        })
        await page.goto('http://localhost:3000/listings', {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        })
        const tab = (name) =>
          page
            .locator('[data-discover]')
            .getByRole('button', { name, exact: true })
        await tab('Resale').waitFor()
        await page.locator('[data-market-grid]').waitFor()
        // Capture the toolbar only after the actual web fonts have settled;
        // font loading changes heading width independently of feed switching.
        await page.evaluate(async () => {
          await document.fonts.ready
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
        })
        const initialGrid = await page
          .locator('[data-market-grid] > div')
          .evaluate((e) => ({
            columns: getComputedStyle(e).gridTemplateColumns,
            gap: getComputedStyle(e).gap,
          }))
        assert.equal(
          initialGrid.columns.split(' ').length,
          width < 640 ? 2 : width < 1024 ? 3 : width < 1440 ? 4 : 5
        )
        assert.equal(
          await page
            .getByRole('button', { name: 'Popular', exact: true })
            .count(),
          0
        )
        const controls = () =>
          page.evaluate(() => {
            const selectors = [
              '[data-discover]',
              'button[aria-label="Sort"]',
              'button[aria-label="Filter"]',
              'header h1',
            ]
            return selectors.map((s) => {
              const n = document.querySelector(s),
                r = n?.getBoundingClientRect()
              return r
                ? { x: r.x, y: r.y, width: r.width, height: r.height }
                : null
            })
          })
        const fixed = await controls()
        const switchAndSample = async (name, outgoing, incoming, direction) => {
          // Sample real transforms frame-by-frame; do not substitute motion mocks.
          await page.evaluate((label) => {
            window.feedFrames = []
            window.feedSamplingDone = false
            const button = Array.from(
              document.querySelectorAll('[data-discover] button')
            ).find((e) => e.textContent.trim() === label)
            button.addEventListener(
              'click',
              () => {
                const start = performance.now()
                function frame() {
                  const v = document.querySelector(
                      '[data-market-feed-viewport]'
                    ),
                    vr = v.getBoundingClientRect()
                  window.feedFrames.push({
                    overflow:
                      document.documentElement.scrollWidth > window.innerWidth,
                    panels: [...v.querySelectorAll('[data-market-feed]')].map(
                      (e) => ({
                        mode: e.getAttribute('data-market-feed'),
                        present: e.getAttribute('data-feed-present'),
                        x: e.getBoundingClientRect().x - vr.x,
                        pointer: getComputedStyle(e).pointerEvents,
                        inert: e.hasAttribute('inert'),
                        hidden: e.getAttribute('aria-hidden'),
                      })
                    ),
                  })
                  if (performance.now() - start < 1800)
                    requestAnimationFrame(frame)
                  else window.feedSamplingDone = true
                }
                requestAnimationFrame(frame)
              },
              { once: true, capture: true }
            )
          }, name)
          await tab(name).click()
          await page.waitForFunction(() => window.feedSamplingDone)
          await page.waitForFunction((mode) => {
            const e = document.querySelector(
              `[data-market-feed="${mode}"][data-feed-present="true"]`
            )
            return (
              e &&
              Math.abs(
                e.getBoundingClientRect().x -
                  e.parentElement.getBoundingClientRect().x
              ) < 0.1
            )
          }, incoming)
          const frames = await page.evaluate(() => window.feedFrames)
          assert(
            frames.every((f) => !f.overflow && f.panels.length <= 1),
            'One clipped feed at a time; no page overflow'
          )
          const exit = frames
            .flatMap((f) => f.panels)
            .filter((p) => p.mode === outgoing && p.present === 'false')
          for (const p of exit) {
            assert.equal(p.pointer, 'none')
            assert(p.inert)
            assert.equal(p.hidden, 'true')
          }
          if (!reduced) {
            assert(
              exit.some((p) => direction * p.x < -1),
              'Outgoing feed exits toward the adjacent page: ' +
                JSON.stringify({
                  outgoing,
                  direction,
                  samples: exit.length,
                  min: Math.min(...exit.map((p) => p.x)),
                  max: Math.max(...exit.map((p) => p.x)),
                })
            )
            const entry = frames
              .flatMap((f) => f.panels)
              .filter((p) => p.mode === incoming && p.present === 'true')
            assert(
              entry.some((p) => direction * p.x > 1),
              'Incoming feed enters from the other side'
            )
          } else
            assert(
              frames.flatMap((f) => f.panels).every((p) => Math.abs(p.x) < 1),
              'Reduced motion has no horizontal travel'
            )
          assert.deepEqual(
            await controls(),
            fixed,
            'Toolbar/Sort/Filter/heading geometry stays fixed'
          )
          assert.equal(await tab(name).getAttribute('aria-pressed'), 'true')
        }
        await switchAndSample('Shop', 'resale', 'shop', 1)
        await page
          .getByText('Shops will appear here when sellers open their storefronts.', { exact: true })
          .waitFor()
        assert.equal(
          await page.locator('[data-market-card]').count(),
          0,
          'No fake Shop cards or membership data'
        )
        await switchAndSample('Resale', 'shop', 'resale', -1)
        assert.deepEqual(
          await page.locator('[data-market-grid] > div').evaluate((e) => ({
            columns: getComputedStyle(e).gridTemplateColumns,
            gap: getComputedStyle(e).gap,
          })),
          initialGrid
        )
        await page.evaluate(async () => {
          const root = document.querySelector('[data-discover]')
          for (const name of ['Shop', 'Resale', 'Shop', 'Resale', 'Shop']) {
            Array.from(root.querySelectorAll('button'))
              .find((b) => b.textContent.trim() === name)
              .click()
            await new Promise((resolve) => setTimeout(resolve, 35))
          }
        })
        await page.waitForFunction(() => {
          const p = document.querySelectorAll('[data-market-feed]')
          return (
            p.length === 1 &&
            p[0].getAttribute('data-market-feed') === 'shop' &&
            Math.abs(
              p[0].getBoundingClientRect().x -
                p[0].parentElement.getBoundingClientRect().x
            ) < 0.1
          )
        })
        assert.equal(await page.locator('[data-market-feed]').count(), 1)
        assert.deepEqual(await controls(), fixed)
        assert.equal(forbidden, 0)
        assert.deepEqual(writes, [])
        console.log(
          `PASS Market Resale/Shop ${width} reduced=${reduced}: direction, fixed controls, inactive exit, rapid switching, unchanged grid, no overflow/writes`
        )
        await context.close()
      }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
