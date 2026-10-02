const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('assert/strict')
const os = require('os')
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
      const login = p.getByRole('link', { name: 'Log in', exact: true })
      assert.equal(await login.getAttribute('href'), '/auth/sign-in')
      assert(
        await login.evaluate((e) =>
          e.classList.contains('shining-button--green')
        )
      )
      const t = p.locator('[data-slot=expandable-card]')
      await t.scrollIntoViewIfNeeded()
      await p.waitForTimeout(1200)
      await p.evaluate(() => {
        const wrapper = document.querySelector('[data-demo-enter=card]'),
          trigger = document.querySelector('[data-slot=expandable-card]'),
          price = trigger.querySelector('[data-slot=collapsed-price]')
        window.listingFrames = []
        window.recording = true
        const frame = () => {
          const media = trigger.firstElementChild
          window.listingFrames.push({
            same: wrapper === document.querySelector('[data-demo-enter=card]'),
            wrapperOpacity: +getComputedStyle(wrapper).opacity,
            wrapperTransform: getComputedStyle(wrapper).transform,
            triggerOpacity: +getComputedStyle(trigger).opacity,
            triggerTransform: getComputedStyle(trigger).transform,
            priceTransform: getComputedStyle(price).transform,
            priceX: price.getBoundingClientRect().x,
            priceY: price.getBoundingClientRect().y,
            missingMedia:
              !document.querySelector('[role=dialog]') &&
              +getComputedStyle(media).opacity < 0.01,
          })
          if (window.recording) requestAnimationFrame(frame)
        }
        frame()
      })
      const y = await p.evaluate(() => scrollY)
      for (let i = 0; i < 3; i++) {
        await t.click()
        const d = p.getByRole('dialog')
        await d.waitFor()
        await p.waitForTimeout(850)
        assert.equal(await p.evaluate(() => scrollY), y)
        const close = d.getByRole('button', { name: 'Close', exact: true })
        const primary = d.getByRole('button', { name: 'Contact seller' })
        assert(
          await primary.evaluate((e) =>
            e.classList.contains('shining-button--green')
          )
        )
        assert.equal(
          await close.evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgb(118, 46, 60)'
        )
        assert.equal(
          await primary
            .locator('span')
            .first()
            .evaluate((e) => getComputedStyle(e).backgroundColor),
          'rgb(22, 101, 52)'
        )
        assert.equal(
          await d
            .locator('[data-slot=expanded-price]')
            .evaluate((e) => getComputedStyle(e).transform),
          'none'
        )
        const cb = await close.boundingBox(),
          pb = await primary.boundingBox()
        assert(cb.x + cb.width < pb.x)
        if (i === 0)
          await p.screenshot({
            path:
              (process.env.SCREENSHOT_DIR || os.tmpdir()) +
              '/trust-modal-' +
              width +
              '.png',
          })
        await p.mouse.move(2, 2)
        await p.mouse.wheel(0, 400)
        await p.waitForTimeout(80)
        assert.equal(await p.evaluate(() => scrollY), y)
        if (i === 0) await close.click()
        else if (i === 1) await p.keyboard.press('Escape')
        else await p.mouse.click(2, 2)
        await d.waitFor({ state: 'detached' })
        await p.waitForTimeout(450)
        assert.equal(await p.evaluate(() => scrollY), y)
        assert(await t.evaluate((e) => e === document.activeElement))
      }
      const frames = await p.evaluate(() => {
        window.recording = false
        return window.listingFrames
      })
      assert(
        frames.every(
          (f) =>
            f.same &&
            f.wrapperOpacity === 1 &&
            f.wrapperTransform === 'none' &&
            f.triggerOpacity === 1 &&
            f.triggerTransform === 'none' &&
            f.priceTransform === 'none' &&
            !f.missingMedia
        )
      )
      assert(
        Math.max(...frames.map((f) => f.priceX)) -
          Math.min(...frames.map((f) => f.priceX)) <
          2
      )
      assert(
        Math.max(...frames.map((f) => f.priceY)) -
          Math.min(...frames.map((f) => f.priceY)) <
          2
      )
      const footer = p.locator('footer[aria-label="About Campus Marketplace"]')
      await footer.scrollIntoViewIfNeeded()
      assert.deepEqual(await footer.getByRole('button').allTextContents(), [
        'Trust',
        'About',
        'Community',
        'Safety',
      ])
      assert.equal(
        await footer
          .getByRole('button', { name: 'Trust', exact: true })
          .getAttribute('aria-pressed'),
        'true'
      )
      assert.equal(await footer.locator('ol li').count(), 5)
      await p.screenshot({
        path:
          (process.env.SCREENSHOT_DIR || os.tmpdir()) +
          '/trust-footer-' +
          width +
          '.png',
      })
      for (const name of ['About', 'Community', 'Safety', 'Trust']) {
        await footer.getByRole('button', { name, exact: true }).click()
        await p.waitForTimeout(600)
        assert.equal(
          await footer
            .getByRole('button', { name, exact: true })
            .getAttribute('aria-pressed'),
          'true'
        )
      }
      assert(
        await footer.getByText('Why trust Campus Marketplace?').isVisible()
      )
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      )
      assert.deepEqual(errors, [])
      await p.emulateMedia({ reducedMotion: 'reduce' })
      await footer.getByRole('button', { name: 'About', exact: true }).click()
      await p.waitForTimeout(100)
      assert(
        await footer
          .getByText(/not an official Western University service/)
          .isVisible()
      )
      console.log(
        'PASS',
        width,
        'three cycles, frame continuity/price anchor, locks/focus, buttons, Trust tabs/reduced motion'
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
