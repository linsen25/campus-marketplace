/* global document, window, getComputedStyle, performance, requestAnimationFrame */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true, args: ['--enable-unsafe-swiftshader'] })
  try {
    for (const width of process.env.BASELINE ? [1280] : [1280, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, serviceWorkers: 'block' })
      await page.route('**/api/auth/session', (route) => route.fulfill({ json: { seller: null } }))
      await page.goto('http://localhost:3100/listings', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await page.waitForTimeout(1500)
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
      await page.waitForTimeout(300)
      const up = page.getByRole('button', { name: 'Return to top', exact: true })
      const nav = page.getByRole('navigation', { name: 'Listing pages' })
      const capture = async (name) => {
        const session = await page.context().newCDPSession(page)
        const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false, optimizeForSpeed: true })
        fs.writeFileSync(`${process.env.TEMP}/market-pagination-${width}-${name}.png`, Buffer.from(shot.data, 'base64'))
        await session.detach()
      }
      await capture(process.env.BASELINE ? 'before' : 'row')
      const position = await up.evaluate((element) => getComputedStyle(element).position)
      if (process.env.BASELINE) {
        console.log(`BASELINE ${width}: Return-to-Top position=${position}; inside pagination=${await nav.getByRole('button', { name: 'Return to top' }).count()}`)
      } else {
        assert.equal(await up.count(), 1)
        assert.equal(await nav.getByRole('button', { name: 'Return to top' }).count(), 1)
        assert.notEqual(position, 'fixed')
        const buttons = nav.getByRole('button')
        const boxes = await buttons.evaluateAll((elements) => elements.map((element) => {
          const rect = element.getBoundingClientRect()
          const style = getComputedStyle(element)
          return { y: rect.y, height: rect.height, radius: style.borderRadius, border: style.border, background: style.backgroundColor }
        }))
        assert(boxes.every((box) => box.y === boxes[0].y && box.height === 44))
        assert.equal(await up.evaluate((element) => element.previousElementSibling.textContent.trim()), 'Next')
        assert.equal(boxes.at(-1).radius, boxes[0].radius)
        assert.equal(boxes.at(-1).border, boxes[0].border)
        assert.equal(boxes.at(-1).background, boxes[0].background)
        const frames = await up.evaluate((element) => new Promise((resolve) => {
          const start = performance.now()
          const samples = []
          element.click()
          const tick = () => {
            samples.push({ ms: performance.now() - start, y: window.scrollY })
            if (performance.now() - start < 800) requestAnimationFrame(tick)
            else resolve(samples)
          }
          requestAnimationFrame(tick)
        }))
        const moved = frames.find((frame) => frame.y < frames[0].y)
        assert(moved && moved.ms < 120, 'Scroll must start immediately, without pagination delay')
        assert(frames.at(-1).y < 30, 'Return reaches browsing top')
        assert((await page.getByRole('button', { name: 'Open search' }).boundingBox()).y >= 0)
        await capture('returned')
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        await up.click()
        assert(await page.evaluate(() => window.scrollY < 30))
        console.log(`PASS ${width}: one pagination row; matching Work Button; no floating instance; immediate scroll (${Math.round(moved.ms)}ms); sticky toolbar retained; reduced motion`)
      }
      await page.close()
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
