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
    for (const width of [390, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route('**/api/auth/session', (r) =>
        r.fulfill({ json: { seller: null } })
      )
      await page.goto('http://localhost:3100/listings', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await page.waitForTimeout(1500)
      const cdp = await page.context().newCDPSession(page)
      const screenshot = async (name) => {
        const r = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
          optimizeForSpeed: true,
        })
        fs.writeFileSync(
          `${process.env.TEMP}/market-handoff-${width}-${name}.png`,
          Buffer.from(r.data, 'base64')
        )
      }
      const button = (name) => page.getByRole('button', { name, exact: true })
      if (width === 390) {
        const nav = page.getByRole('navigation', {
          name: 'Home and Market navigation',
        })
        await nav.waitFor()
        const market = nav.getByRole('tab', { name: 'Market', exact: true })
        const home = nav.getByRole('tab', { name: 'Home', exact: true })
        const indicator = nav.locator('[aria-selected="true"] > [aria-hidden]')
        assert.equal(
          await indicator.evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgb(255, 255, 255)'
        )
        assert.equal(
          await market.evaluate((e) => getComputedStyle(e).color),
          'rgb(24, 24, 27)'
        )
        assert.equal(
          await home.evaluate((e) => getComputedStyle(e).color),
          'rgb(255, 255, 255)'
        )
        assert.equal(
          await home.evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgb(16, 16, 19)'
        )
        const box = await indicator.boundingBox()
        await home.click()
        await page.waitForTimeout(80)
        const moving = await indicator.boundingBox()
        assert(moving.x > box.x && moving.x < (await home.boundingBox()).x)
        await screenshot('tabs-moving')
        await page.waitForTimeout(700)
        await market.click()
        await page.waitForTimeout(700)
        await screenshot('tabs')
        console.log(
          'PASS tabs: white/dark active; dark/white inactive; sliding spring remains'
        )
      }
      let reference
      for (const context of width === 390
        ? ['normal', 'search', 'filter', 'sort']
        : ['normal']) {
        if (context === 'search') {
          await button('Open search').click()
          const input = page.getByRole('combobox', { name: 'Search listings' })
          await input.fill('MacBook')
          await input.press('Enter')
          await page
            .locator('[data-market-focus-backdrop]')
            .waitFor({ state: 'detached' })
        } else if (context === 'filter') {
          await button('Open search').click()
          const input = page.getByRole('combobox', { name: 'Search listings' })
          await input.fill('')
          await input.press('Enter')
          await page
            .locator('[data-market-focus-backdrop]')
            .waitFor({ state: 'detached' })
          await button('Filter').click()
          await page.waitForTimeout(400)
          await page
            .getByRole('combobox', { name: 'Category', exact: true })
            .click()
          await page
            .getByRole('option', { name: 'Electronics', exact: true })
            .click()
          await button('Confirm').click()
          await page
            .locator('[data-market-focus-backdrop]')
            .waitFor({ state: 'detached' })
        } else if (context === 'sort') {
          await button('Sort').click()
          await page.waitForTimeout(700)
          await button('Price: High to Low').click()
          await page
            .locator('[data-market-focus-backdrop]')
            .waitFor({ state: 'detached' })
        }
        const card = page
          .getByRole('button', {
            name: /Open example listing: MacBook Air M1,/,
          })
          .first()
        await card.evaluate((e) => {
          window.source = e
          window.sourceImage = e.querySelector('img')
        })
        const sourceRect = await card.boundingBox()
        await card.click()
        const dialog = page.getByRole('dialog')
        await dialog.waitFor()
        await page.waitForTimeout(850)
        const geometry = await dialog.evaluate((e) => {
          const image = e.querySelector('img')
          const price = e.querySelector('[data-slot="expanded-price"]')
          const info = price.parentElement
          const area = info.parentElement
          return {
            image: image.getBoundingClientRect().toJSON(),
            info: info.getBoundingClientRect().toJSON(),
            price: price.getBoundingClientRect().toJSON(),
            dialog: e.getBoundingClientRect().toJSON(),
            gridRows: getComputedStyle(area).gridTemplateRows,
            location: Array.from(e.querySelectorAll('p'))
              .find((x) => x.textContent.startsWith('Location:'))
              ?.getBoundingClientRect()
              .toJSON(),
          }
        })
        if (width === 390) {
          assert(geometry.info.y >= geometry.image.bottom)
          assert(geometry.price.y >= geometry.image.bottom + 23)
          assert(geometry.location.y >= geometry.image.bottom)
          assert(geometry.location.height > 20)
          assert(geometry.dialog.height <= 884)
          if (reference)
            assert.deepEqual(
              geometry,
              reference,
              'All contexts use identical mobile geometry'
            )
          else reference = geometry
        } else {
          assert.equal(geometry.dialog.width, 1040)
          assert.equal(geometry.image.width, 470)
          assert.equal(geometry.image.height, 587.5)
          assert.equal(geometry.price.y, 138.25)
          assert.equal(geometry.price.x, width === 1280 ? 659 : 787)
          assert.equal(geometry.location.height, 0)
        }
        await screenshot(`${context}-open`)
        if (width === 390) {
          await dialog
            .locator('p')
            .filter({ hasText: 'Location:' })
            .scrollIntoViewIfNeeded()
          await screenshot(`${context}-location`)
          await dialog
            .getByText('Description', { exact: true })
            .scrollIntoViewIfNeeded()
          await screenshot(`${context}-description`)
          await dialog
            .locator('[data-slot="expanded-price"]')
            .evaluate((e) => (e.parentElement.parentElement.scrollTop = 0))
        }
        await page.evaluate(() => {
          window.handoff = []
          const start = performance.now()
          const source = window.source
          const image = window.sourceImage
          const sample = () => {
            const ret = document.querySelector('[data-slot="returning-media"]')
            const sourceImg = source.querySelector('img')
            const sourceMotion = sourceImg.parentElement.parentElement
            const rect = sourceImg.getBoundingClientRect()
            window.handoff.push({
              t: performance.now() - start,
              returning: !!ret,
              source: getComputedStyle(source).visibility,
              same: sourceImg === image,
              decoded: sourceImg.complete && sourceImg.naturalWidth > 0,
              opacity: getComputedStyle(sourceMotion).opacity,
              transform: getComputedStyle(sourceMotion).transform,
              rect: rect.toJSON(),
              returnOpacity: ret ? getComputedStyle(ret).opacity : null,
            })
            if (performance.now() - start < 1350) requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
          Array.from(document.querySelectorAll('[role="dialog"] button'))
            .find((e) => e.textContent.trim() === 'Close')
            .click()
        })
        await page.waitForTimeout(560)
        for (let i = 0; i < 5; i++) {
          await screenshot(`${context}-handoff-${i}`)
          await page.waitForTimeout(20)
        }
        await page.waitForFunction(() => !window.source.dataset.sourceHidden)
        await page.waitForTimeout(600)
        const frames = await page.evaluate(() => window.handoff)
        assert(frames.every((f) => f.same && f.decoded))
        assert(
          frames
            .filter((f) => f.source === 'hidden')
            .every((f) => f.returning && f.returnOpacity === '1')
        )
        for (const f of frames.filter((f) => f.source === 'visible')) {
          assert.equal(f.opacity, '1')
          assert.equal(f.transform, 'none')
          assert(Math.abs(f.rect.width - sourceRect.width) < 0.1)
          assert(Math.abs(f.rect.x - sourceRect.x) < 0.1)
          assert(Math.abs(f.rect.y - sourceRect.y) < 0.1)
          assert(Math.abs(f.rect.height - sourceRect.width) < 0.1)
        }
        fs.writeFileSync(
          `${process.env.TEMP}/market-handoff-${width}-${context}.json`,
          JSON.stringify(frames)
        )
        await screenshot(`${context}-restored`)
        console.log(
          'PASS',
          width,
          context,
          'correct flow; mounted/decoded source; no opacity or transform on final handoff'
        )
      }
      if (width >= 1024) {
        assert.equal(
          await page
            .getByRole('navigation', { name: 'Home and Market navigation' })
            .isVisible(),
          false
        )
        await page.evaluate(() => scrollTo(0, 501))
        await button('Return to top').waitFor()
        await button('Return to top').click()
        await page.waitForTimeout(800)
        assert.equal(await page.evaluate(() => scrollY), 0)
        console.log(
          'PASS',
          width,
          'desktop split geometry and Return-to-Top unchanged'
        )
      }
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
