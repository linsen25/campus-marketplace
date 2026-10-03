// Auth presentation regression with logged-out mocked session; no live email.
/* global document, window, getComputedStyle, requestAnimationFrame */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
const base = process.env.BASE_URL || 'http://localhost:3100'
const reduced = process.env.REDUCED_MOTION === '1'
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 768, 834, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
        reducedMotion: reduced ? 'reduce' : 'no-preference',
      })
      await page.route('**/api/auth/session', (route) =>
        route.fulfill({ json: { seller: null } })
      )
      await page.goto(base + '/', { waitUntil: 'load', timeout: 60000 })
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await auth.waitFor()
      const settled = async (mode) => {
        await page.waitForFunction((m) => {
          const form = document.querySelector(
            'dialog[aria-labelledby="auth-title"] form'
          )
          return (
            form?.getAttribute('data-auth-mode') === m &&
            getComputedStyle(form).opacity === '1'
          )
        }, mode)
      }
      await settled('signin')
      await page.waitForFunction(
        () =>
          getComputedStyle(
            document.querySelector('dialog[aria-labelledby="auth-title"]')
          ).opacity === '1'
      )
      await auth
        .getByLabel('Western email', { exact: true })
        .fill('polish-test@uwo.ca')
      await auth.evaluate((e) => {
        window.stableAuth = {
          dialog: e,
          header: e.querySelector('#auth-title').parentElement,
          card: e.querySelector('form').parentElement,
          privacy: e.querySelector('section > p'),
          form: e.querySelector('form'),
        }
        window.modeFrames = []
        window.sampleModes = true
        function sample() {
          const form = e.querySelector('form')
          window.modeFrames.push({
            mode: form.getAttribute('data-auth-mode'),
            opacity: Number(getComputedStyle(form).opacity),
            modal: Number(getComputedStyle(e).opacity),
            surfaces: [
              window.stableAuth.header,
              window.stableAuth.card,
              window.stableAuth.privacy,
            ].map((s) => Number(getComputedStyle(s).opacity)),
          })
          if (window.sampleModes) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      for (const mode of ['signup', 'signin', 'signup', 'signin', 'signup']) {
        await auth
          .getByRole('tab', {
            name: mode === 'signin' ? 'Log in' : 'Sign up',
            exact: true,
          })
          .first()
          .click()
        await settled(mode)
        assert.equal(
          await auth.getByLabel('Western email', { exact: true }).inputValue(),
          'polish-test@uwo.ca'
        )
        assert(
          await auth.evaluate(
            (e) =>
              e === window.stableAuth.dialog &&
              e.querySelector('#auth-title').parentElement ===
                window.stableAuth.header &&
              e.querySelector('form').parentElement ===
                window.stableAuth.card &&
              e.querySelector('section > p') === window.stableAuth.privacy &&
              e.querySelector('form') === window.stableAuth.form
          )
        )
      }
      const frames = await page.evaluate(() => {
        window.sampleModes = false
        return window.modeFrames
      })
      if (!reduced) assert(frames.some((f) => f.opacity > 0 && f.opacity < 1))
      assert(
        frames.every((f) => f.modal === 1 && f.surfaces.every((o) => o === 1)),
        'Only mode content fades'
      )
      for (let i = 1; !reduced && i < frames.length; i++) {
        if (frames[i].mode !== frames[i - 1].mode)
          assert(
            frames[i - 1].opacity < 0.08,
            'Old content fades before replacement'
          )
      }
      await auth.locator('form').evaluate((form) => form.requestSubmit())
      await auth
        .getByText('Password must meet all requirements.', { exact: true })
        .waitFor()
      await auth
        .getByRole('tab', { name: 'Log in', exact: true })
        .first()
        .click()
      await settled('signin')
      assert.equal(await auth.locator('ul').count(), 0)
      assert.equal(
        await auth
          .getByText('Password must meet all requirements.', { exact: true })
          .count(),
        0
      )
      await page.keyboard.press('Escape')
      await auth.waitFor({ state: 'detached' })
      await page.locator('[data-slot="expandable-card"]').click()
      const contact = page.getByRole('button', {
        name: 'Contact seller',
        exact: true,
      })
      await contact.waitFor()
      await page.waitForTimeout(800)
      const before = await page.evaluate(() => window.scrollY)
      assert(before > 500)
      await page.evaluate(() => {
        window.scrollFrames = []
        window.sampleScroll = true
        function sample() {
          window.scrollFrames.push(window.scrollY)
          if (window.sampleScroll) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      for (let cycle = 0; cycle < 3; cycle++) {
        for (const method of ['X', 'Escape', 'backdrop']) {
          await contact.click()
          await auth.waitFor()
          await settled('signin')
          if (method === 'X')
            await auth
              .getByRole('button', { name: 'Close authentication' })
              .click()
          else if (method === 'Escape') await page.keyboard.press('Escape')
          else await page.mouse.click(2, 2)
          await auth.waitFor({ state: 'detached' })
          assert(
            Math.abs((await page.evaluate(() => window.scrollY)) - before) <= 1
          )
          assert(await contact.evaluate((e) => document.activeElement === e))
          assert.equal(
            await page.evaluate(() => document.body.style.overflow),
            'hidden',
            'Underlying listing lock remains owned by listing'
          )
        }
      }
      const scrollFrames = await page.evaluate(() => {
        window.sampleScroll = false
        return window.scrollFrames
      })
      assert(
        scrollFrames.every((y) => Math.abs(y - before) <= 1),
        `No intermediate jump: ${Math.min(...scrollFrames)}..${Math.max(
          ...scrollFrames
        )} vs ${before}`
      )
      await page.keyboard.press('Escape')
      if (width === 390) {
        await page.setViewportSize({ width, height: 420 })
        await page.getByRole('button', { name: 'Log in', exact: true }).click()
        await auth.waitFor()
        await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
        await settled('signup')
        await page.waitForTimeout(700)
        assert(await auth.evaluate((e) => e.scrollHeight > e.clientHeight))
        assert.equal(await auth.getAttribute('data-scrolling'), null)
        assert(
          !(
            await auth.evaluate((e) => getComputedStyle(e).scrollbarColor)
          ).includes('245')
        )
        for (let i = 0; i < 3; i++) {
          const bounds = await auth.boundingBox()
          await page.mouse.move(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          )
          const top = await auth.evaluate((e) => e.scrollTop)
          await page.mouse.wheel(0, 80)
          await page.waitForFunction(() =>
            document
              .querySelector('dialog[aria-labelledby="auth-title"]')
              .hasAttribute('data-scrolling')
          )
          assert(
            (
              await auth.evaluate((e) => getComputedStyle(e).scrollbarColor)
            ).includes('245')
          )
          assert((await auth.evaluate((e) => e.scrollTop)) > top)
          await page.waitForTimeout(750)
          assert.equal(await auth.getAttribute('data-scrolling'), null)
          assert(
            !(
              await auth.evaluate((e) => getComputedStyle(e).scrollbarColor)
            ).includes('245')
          )
        }
        await page.keyboard.press('Escape')
        await auth.waitFor({ state: 'detached' })
      }
      console.log(
        `PASS ${width}${
          reduced ? ' reduced motion' : ''
        }: mode switches on persistent surfaces, email/error handling, 9 contact dismissals at scrollY=${before} with every frame within 1px${
          width === 390
            ? ', and 3 active-scroll/600ms-idle scrollbar cycles'
            : ''
        }`
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
