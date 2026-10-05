/* global window, document, getComputedStyle, requestAnimationFrame, performance */
const assert = require('node:assert/strict')
const sharp = require('sharp')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: ['--enable-unsafe-swiftshader', '--disable-features=OverlayScrollbar'],
  })
  try {
    for (const width of [1280, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (route) => route.abort())
      await page.route('**/api/auth/session', (route) => route.fulfill({ json: { seller: null } }))
      const hidden = 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)'
      const visible = 'rgb(245, 245, 245) rgba(0, 0, 0, 0)'
      const color = () => page.evaluate(() => getComputedStyle(document.documentElement).scrollbarColor)
      const geometry = () => page.evaluate(() => {
        const header = document.querySelector('header').getBoundingClientRect()
        const grid = document.querySelector('[data-market-grid]').getBoundingClientRect()
        return { headerX: header.x, headerWidth: header.width, headerTop: header.y,
          gridX: grid.x, gridWidth: grid.width, viewportWidth: document.documentElement.clientWidth }
      })
      await page.goto('http://localhost:3100/listings', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.locator('[data-market-ready="true"]').waitFor()
      await page.waitForTimeout(1500)
      assert.equal(await color(), hidden, 'Initial idle thumb is transparent')
      const initial = await geometry()
      const gutter = width - initial.viewportWidth
      assert(gutter > 0, 'Validate with native scrollbars actually rendered')
      const gutterPixel = async (buffer) => {
        const { data } = await sharp(buffer).extract({
          left: Math.floor(width - gutter / 2), top: 300, width: 1, height: 1,
        }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
        return Array.from(data)
      }
      await page.mouse.move(width - 2, 300)
      await page.waitForTimeout(750)
      assert.equal(await color(), hidden, 'Right-edge hover does not reveal thumb')
      const idleShot = await page.screenshot({ path: `${process.env.TEMP}/market-page-scrollbar-${width}-idle.png` })
      assert((await gutterPixel(idleShot)).every((channel) => channel < 30), 'Idle gutter/transparent thumb paints dark')
      await page.mouse.move(width / 2, 450)
      await page.evaluate(() => {
        window.scrollbarFrames = []
        window.lastPageScroll = 0
        window.addEventListener('scroll', () => { window.lastPageScroll = performance.now() })
        const sample = () => {
          const root = document.documentElement
          window.scrollbarFrames.push({
            time: performance.now(), lastScroll: window.lastPageScroll,
            active: root.className.includes('viewportScrolling'),
            color: getComputedStyle(root).scrollbarColor,
            duration: getComputedStyle(root).transitionDuration,
          })
          requestAnimationFrame(sample)
        }
        sample()
      })
      await page.mouse.wheel(0, 300)
      await page.waitForFunction(() => window.scrollY > 0)
      await page.waitForTimeout(180)
      assert.equal(await color(), visible, 'Actual wheel scroll reveals thumb')
      assert.deepEqual(await geometry(), initial, 'Sticky header, grid and gutter widths stay fixed')
      const scrollShot = await page.screenshot({ path: `${process.env.TEMP}/market-page-scrollbar-${width}-scroll.png` })
      assert((await gutterPixel(scrollShot)).every((channel) => channel > 230), 'Active native thumb actually paints near-white')
      await page.waitForTimeout(850)
      assert.equal(await color(), hidden, 'Thumb hides after 600ms idle')
      const frames = await page.evaluate(() => window.scrollbarFrames)
      const intermediate = (frame) => frame.color !== hidden && frame.color !== visible
      assert(frames.some((frame) => frame.active && intermediate(frame)), 'Fade-in has intermediate thumb colors')
      assert(frames.some((frame) => !frame.active && intermediate(frame)), 'Fade-out has intermediate thumb colors')
      assert(frames.filter((frame) => frame.active).every((frame) => frame.duration === '0.14s'))
      assert(frames.filter((frame) => !frame.active).every((frame) => frame.duration === '0.2s'))
      const fadeStart = frames.find((frame) => frame.lastScroll && !frame.active)
      assert(fadeStart.time - fadeStart.lastScroll >= 590 && fadeStart.time - fadeStart.lastScroll < 680, '600ms visible hold before fade-out')
      await page.mouse.wheel(0, 120)
      await page.waitForFunction(() => getComputedStyle(document.documentElement).scrollbarColor.startsWith('rgb(245'))
      await page.waitForTimeout(400)
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(350)
      assert.equal(await color(), visible, 'Resumed scrolling resets idle timer')
      await page.waitForTimeout(600)
      assert.equal(await color(), hidden)
      await page.mouse.wheel(0, -120)
      await page.waitForFunction(() => {
        const root = document.documentElement
        const current = getComputedStyle(root).scrollbarColor
        return !root.className.includes('viewportScrolling') && current.startsWith('rgba(245')
      })
      await page.mouse.wheel(0, -120)
      await page.waitForTimeout(180)
      assert.equal(await color(), visible, 'Scrolling during fade-out smoothly restores visible thumb')
      await page.waitForTimeout(850)
      // Focus the document via empty header padding, never a listing card.
      await page.mouse.click(20, 20)
      await page.keyboard.press('PageUp')
      await page.waitForFunction(() => getComputedStyle(document.documentElement).scrollbarColor.startsWith('rgb(245'))
      await page.waitForTimeout(1100)
      assert.equal(await color(), hidden, 'Keyboard scrolling also returns to idle')
      await page.getByRole('button', { name: 'Return to top', exact: true }).click()
      await page.waitForTimeout(1500)
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'Existing Return-to-Top still works')
      assert.deepEqual(await geometry(), initial)
      assert.equal(await color(), hidden)
      await page.setViewportSize({ width: 390, height: 844 })
      assert(await page.evaluate(() => !document.documentElement.className.includes('desktopViewport')), 'Mobile has no new scrollbar styles')
      await page.setViewportSize({ width, height: 900 })
      await page.goto('http://localhost:3100/home', { waitUntil: 'domcontentloaded' })
      assert(await page.evaluate(() => !document.documentElement.className.includes('desktopViewport')), 'Market styles cleaned up on Home')
      assert.deepEqual(errors, [])
      console.log(`PASS ${width}: 140ms fade-in, 600ms hold, 200ms fade-out, interrupted fade resumes, idle/hover hidden, stable header/grid/gutter, Return-to-Top, mobile and Home cleanup`)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => { console.error(error); process.exitCode = 1 })
