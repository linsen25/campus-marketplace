// Browser integration regression. See docs/HOMEPAGE_DESIGN.md for prerequisites.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('assert/strict')
;(async () => {
  const b = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 1280, 1536]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.goto((process.env.BASE_URL || 'http://localhost:3100') + '/')
      const section = p.locator('[data-home-section=listing-demo]')
      await section.waitFor({ state: 'attached' })
      await p.waitForTimeout(700)
      const before = await section
        .locator('[data-demo-enter]')
        .evaluateAll((es) => es.map((e) => +getComputedStyle(e).opacity))
      assert(
        before.every((v) => v === 0),
        'initial fade state'
      )
      const placement = await section.evaluate((e) => ({
        parallax: document
          .querySelector('[data-slot=hero-parallax]')
          .compareDocumentPosition(e),
        footer: e.compareDocumentPosition(
          document.querySelector(
            'footer[aria-label="About Campus Marketplace"]'
          )
        ),
      }))
      assert(placement.parallax & 4)
      assert(placement.footer & 4)
      await section.scrollIntoViewIfNeeded()
      await p.waitForTimeout(1200)
      const trigger = p.locator('[data-slot=expandable-card]')
      assert.equal((await trigger.innerText()).trim(), 'CA$45')
      const square = await trigger.locator('img').boundingBox()
      assert(Math.abs(square.width / square.height - 1) < 0.01)
      const video = p.getByLabel('Create Listing Demo video placeholder')
      const v = await video.boundingBox()
      assert(Math.abs(v.width / v.height - 16 / 9) < 0.01)
      if (width < 768) assert(v.y > square.y + square.height)
      else assert(v.x > square.x + square.width)
      await p.screenshot({
        path:
          (process.env.SCREENSHOT_DIR || require('node:os').tmpdir()) +
          '/listing-section-' +
          width +
          '.png',
      })
      await trigger.scrollIntoViewIfNeeded()
      const y = await p.evaluate(() => scrollY)
      await trigger.click()
      const dialog = p.getByRole('dialog')
      await dialog.waitFor()
      await p.waitForTimeout(1000)
      assert(
        await p.evaluate(
          () =>
            document.body.style.overflow === 'hidden' &&
            document.getElementById('__next').hasAttribute('inert')
        )
      )
      const d = await dialog.boundingBox(),
        media = await dialog.locator('img').boundingBox()
      assert(
        Math.abs(media.width / media.height - (width < 768 ? 4 / 3 : 4 / 5)) <
          0.01
      )
      assert(width < 768 ? d.width > width * 0.9 : d.width > square.width * 1.8)
      await p.screenshot({
        path:
          (process.env.SCREENSHOT_DIR || require('node:os').tmpdir()) +
          '/listing-expanded-' +
          width +
          '.png',
      })
      await dialog
        .getByRole('button', { name: 'Favorite example listing' })
        .click()
      assert.equal(
        await dialog
          .getByRole('button', { name: 'Favorite example listing' })
          .getAttribute('aria-pressed'),
        'true'
      )
      await dialog.getByRole('button', { name: 'Contact seller' }).click()
      assert(
        await dialog
          .getByText(
            'This is an example listing. No seller has been contacted.'
          )
          .isVisible()
      )
      await p.keyboard.press('Tab')
      assert(await dialog.evaluate((e) => e.contains(document.activeElement)))
      await p.mouse.wheel(0, 550)
      await p.keyboard.press('Escape')
      await dialog.waitFor({ state: 'detached' })
      await p.waitForTimeout(300)
      assert.equal(await p.evaluate(() => scrollY), y)
      assert(await trigger.evaluate((e) => e === document.activeElement))
      await trigger.click()
      await p.waitForTimeout(700)
      await p
        .getByRole('dialog')
        .getByRole('button', { name: 'Close', exact: true })
        .click()
      await p.getByRole('dialog').waitFor({ state: 'detached' })
      await p.waitForTimeout(200)
      assert.equal(await p.evaluate(() => scrollY), y)
      if (width >= 768) {
        await trigger.click()
        await p.waitForTimeout(700)
        await p.mouse.click(3, 3)
        await p.getByRole('dialog').waitFor({ state: 'detached' })
      }
      await p.evaluate(() => scrollTo(0, 0))
      await p.waitForTimeout(150)
      assert(
        (
          await section
            .locator('[data-demo-enter]')
            .evaluateAll((es) => es.map((e) => +getComputedStyle(e).opacity))
        ).every((x) => x === 1),
        'entrance never replays'
      )
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        'ratios/placement/actions/lock/focus/escape/close/once'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
