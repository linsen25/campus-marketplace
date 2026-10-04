/* global document, window, getComputedStyle, requestAnimationFrame, performance */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
      await page.route('**/api/auth/session', (r) => r.fulfill({ json: { seller: null } }))
      await page.goto('http://localhost:3100/listings', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await page.waitForTimeout(1500)
      const cdp = await page.context().newCDPSession(page)
      const capture = async (name) => {
        const result = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true })
        fs.writeFileSync(`${process.env.TEMP}/market-price-${width}-${name}.png`, Buffer.from(result.data, 'base64'))
      }
      const sample = async (closing) => page.evaluate((closing) => {
        const card = document.querySelector('[data-slot="expandable-card"]')
        const price = card.querySelector('[data-slot="collapsed-price"]')
        window.priceSamples = []
        window.priceNode = price
        const start = performance.now()
        const tick = () => {
          const expanded = document.querySelector('[data-slot="expanded-price"]')
          const returning = document.querySelector('[data-slot="returning-media"]')
          const info = expanded?.parentElement
          const media = card.querySelector('img')
          window.priceSamples.push({
            ms: performance.now() - start,
            source: Number(getComputedStyle(price).opacity),
            expanded: info ? Number(getComputedStyle(info).opacity) : 0,
            hidden: card.hasAttribute('data-source-hidden'),
            returning: Boolean(returning),
            returnOpacity: returning ? Number(getComputedStyle(returning).opacity) : null,
            sameNode: card.querySelector('[data-slot="collapsed-price"]') === window.priceNode,
            sourceTransform: media ? getComputedStyle(media.parentElement.parentElement).transform : 'none',
          })
          if (performance.now() - start < 1500) requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
        if (closing) Array.from(document.querySelectorAll('[role="dialog"] button')).find((b) => b.textContent.trim() === 'Close').click()
        else card.click()
      }, closing)
      await sample(false)
      await page.waitForTimeout(40)
      await capture('opening')
      await page.waitForTimeout(1500)
      const opening = await page.evaluate(() => window.priceSamples)
      assert(opening.some((f) => f.source > 0 && f.source < 1), 'Opening source price must fade')
      assert(opening.every((f) => !(f.source > 0.01 && f.expanded > 0.01)), 'Prices must not overlap')
      await capture('expanded')
      await sample(true)
      await page.waitForTimeout(45)
      await capture('closing-text')
      await page.waitForFunction(() => {
        const card = document.querySelector('[data-slot="expandable-card"]')
        return !card.hasAttribute('data-source-hidden')
      }, null, { polling: 'raf' })
      await capture('price-fading-in')
      await page.waitForTimeout(1600)
      const closing = await page.evaluate(() => window.priceSamples)
      assert(closing.some((f) => f.expanded > 0 && f.expanded < 1), 'Expanded text must fade')
      assert(closing.filter((f) => f.hidden).every((f) => f.source < 0.001), 'Price stays hidden until confirmed handoff')
      assert(closing.some((f) => !f.hidden && f.source > 0 && f.source < 1), 'Landed source price must fade in')
      assert(closing.every((f) => f.sameNode), 'Price remains mounted')
      assert(closing.every((f) => f.returnOpacity === null || f.returnOpacity === 1), 'Returning image stays opaque')
      assert(closing.filter((f) => !f.hidden).every((f) => f.sourceTransform === 'none'), 'Restored source remains static')
      assert(closing.every((f) => !(f.source > 0.01 && f.expanded > 0.01)), 'Closing prices must not overlap')
      assert.equal(closing.at(-1).source, 1)
      assert.equal(closing.at(-1).hidden, false)
      await capture('restored')
      console.log(`PASS ${width}: opening fade, expanded close fade, source fade only after handoff, mounted price, no overlapping prices, opaque return`)
      console.log(JSON.stringify({ width, landing: closing.find((f) => !f.hidden), fading: closing.find((f) => !f.hidden && f.source > 0 && f.source < 1) }))
      await page.close()
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
