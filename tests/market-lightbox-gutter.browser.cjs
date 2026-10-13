/* global document, window, getComputedStyle, requestAnimationFrame */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const base = process.env.BASE_URL || 'http://localhost:3000'
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    ignoreDefaultArgs: ['--hide-scrollbars'],
    args: [
      '--disable-features=OverlayScrollbar',
      '--enable-unsafe-swiftshader',
    ],
  })
  const artifacts = 'tests/artifacts/market-lightbox-gutter'
  fs.mkdirSync(artifacts, { recursive: true })
  try {
    for (const width of [1280, 1536, 390, 430]) {
      const page = await browser.newPage({
        viewport: { width, height: 600 },
        serviceWorkers: 'block',
        hasTouch: width < 1024,
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      // Public listing inspection needs no login or authenticated mutations.
      await page.route('**/api/auth/session', (route) =>
        route.fulfill({ json: { seller: null } })
      )
      await page.goto(base + '/listings', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      const cards = page.locator('[data-market-card]')
      await cards.first().waitFor()
      await page.waitForTimeout(1000)
      await page.evaluate(() => {
        // Ensure the scroll-lock test has a real overflow even with a small dataset.
        const probe = document.createElement('div')
        probe.style.height = '1200px'
        probe.dataset.scrollTestProbe = 'true'
        document.body.append(probe)
      })
      const geometry = () =>
        page.evaluate(() => ({
          cards: Array.from(
            document.querySelectorAll('[data-market-card]')
          ).map((node) => {
            const rect = node.getBoundingClientRect()
            return { x: rect.x, width: rect.width }
          }),
          padding: getComputedStyle(document.body).paddingRight,
          rootWidth: document.documentElement.getBoundingClientRect().width,
          gutter: getComputedStyle(document.documentElement).scrollbarGutter,
          overflow: document.documentElement.style.overflow,
        }))
      const before = await geometry()
      assert(before.gutter.includes('stable'))
      assert(
        width - before.rootWidth > 0,
        'Exercise classic, non-overlay scrollbar gutter'
      )
      await page.evaluate(() => {
        window.lightboxFrames = []
        window.sampleLightbox = true
        const sample = () => {
          if (!window.sampleLightbox) return
          window.lightboxFrames.push(
            Array.from(document.querySelectorAll('[data-market-card]')).map(
              (node) => {
                const rect = node.getBoundingClientRect()
                return { x: rect.x, width: rect.width }
              }
            )
          )
          requestAnimationFrame(sample)
        }
        sample()
      })
      await cards.first().locator('[data-slot="expandable-card"]').click()
      const dialog = page.locator(
        '[data-slot="listing-overlay"] [role="dialog"]'
      )
      await dialog.waitFor({ state: 'visible' })
      await page.waitForFunction(
        () => document.documentElement.style.overflow === 'hidden'
      )
      await page.waitForTimeout(600)
      const opened = await geometry()
      assert.deepEqual(
        opened.cards,
        before.cards,
        'Cards keep exact horizontal geometry when opened'
      )
      assert.equal(
        opened.padding,
        before.padding,
        'No double padding compensation'
      )
      assert.equal(opened.rootWidth, before.rootWidth)
      const scroll = await page.evaluate(() => window.scrollY)
      await page.mouse.move(5, 300)
      await page.mouse.wheel(0, 300)
      await page.waitForTimeout(150)
      assert.equal(
        await page.evaluate(() => window.scrollY),
        scroll,
        'Background scrolling stays locked'
      )
      await page.screenshot({ path: `${artifacts}/${width}-open.png` })
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.waitForFunction(
        () => document.documentElement.style.overflow !== 'hidden'
      )
      await page.waitForTimeout(500)
      const closed = await geometry()
      assert.deepEqual(
        closed,
        before,
        'Styles and horizontal geometry restore after close'
      )
      const frames = await page.evaluate(() => {
        window.sampleLightbox = false
        return window.lightboxFrames
      })
      assert(frames.length > 2)
      for (const frame of frames)
        assert.deepEqual(
          frame,
          before.cards,
          'No horizontal shift during open/close animation'
        )
      await page.mouse.move(5, 300)
      await page.mouse.wheel(0, 300)
      await page.waitForFunction(
        (previous) => window.scrollY > previous,
        scroll
      )
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        true
      )
      assert.deepEqual(errors, [])
      console.log(
        JSON.stringify({
          width,
          cardShiftPx: 0,
          gutterPixels: width - before.rootWidth,
          doubleCompensation: false,
          lockAndRestore: true,
          runtimeErrors: 0,
        })
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
