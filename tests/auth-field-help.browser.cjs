/* global document, window, getComputedStyle, requestAnimationFrame, innerWidth */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const reduced of [false, true])
      for (const width of [390, 768, 834, 1280, 1536]) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
          serviceWorkers: 'block',
        })
        let posts = 0
        await page.route('**/api/auth/**', (route) => {
          if (route.request().method() === 'POST') posts++
          return route.fulfill({ json: { seller: null } })
        })
        await page.goto(process.env.BASE_URL || 'http://localhost:3100', {
          timeout: 60000,
        })
        await page.getByRole('button', { name: 'Log in', exact: true }).click()
        const auth = page.locator('dialog[aria-labelledby="auth-title"]')
        const username = auth.getByLabel('Username', { exact: true })
        const password = auth.getByLabel('Password', { exact: true })
        assert.equal(await username.count(), 0)
        await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
        await username.waitFor()
        const userHelp = auth.locator('[id$="-username-help"]')
        const passHelp = auth.locator('[id$="-password-help"]')
        const settled = async (active) =>
          page.waitForFunction((name) => {
            const helps = [
              ...document.querySelectorAll(
                'dialog[aria-labelledby="auth-title"] [id$="-help"]'
              ),
            ]
            return (
              helps.length === 2 &&
              helps.every((e) =>
                name && e.id.endsWith(`-${name}-help`)
                  ? getComputedStyle(e).opacity === '1' && e.clientHeight > 0
                  : e.clientHeight === 0
              )
            )
          }, active)
        await settled(null)
        await username.click()
        await settled('username')
        for (const [value, count] of [
          ['ab', 1],
          ['alex_123', 2],
          ['alex!', 1],
        ]) {
          await username.fill(value)
          assert.equal(
            await userHelp.locator('li[class*="met"]').count(),
            count
          )
        }
        await username.fill('alex_123')
        await page.evaluate(() => {
          window.helpFrames = []
          window.sampleHelp = true
          function sample() {
            window.helpFrames.push({
              y: window.scrollY,
              heights: [...document.querySelectorAll('[id$="-help"]')].map(
                (e) => e.clientHeight
              ),
            })
            if (window.sampleHelp) requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        for (let i = 0; i < 4; i++) {
          await password.click()
          await settled('password')
          assert.equal(await passHelp.locator('li').count(), 4)
          if (i === 0)
            assert.equal(await passHelp.locator('li[class*="met"]').count(), 0)
          for (const [value, count] of [
            ['Abc', 1],
            ['Abcdefgh', 2],
            ['Abcdefg1', 3],
            ['Abcdefg1!', 4],
          ]) {
            await password.fill(value)
            assert.equal(
              await passHelp.locator('li[class*="met"]').count(),
              count
            )
          }
          await auth
            .getByRole('button', { name: 'Show password', exact: true })
            .click()
          await settled('password')
          await auth
            .getByRole('button', { name: 'Hide password', exact: true })
            .click()
          await settled('password')
          await username.click()
          await settled('username')
          assert.equal(await username.inputValue(), 'alex_123')
          assert.equal(await password.inputValue(), 'Abcdefg1!')
          assert.equal(await auth.locator('[data-help-open]').count(), 1)
        }
        const frames = await page.evaluate(() => {
          window.sampleHelp = false
          return window.helpFrames
        })
        assert(
          frames.every((f) => f.y === frames[0].y),
          'No underlying page jump'
        )
        if (!reduced)
          assert(
            frames.some((f) => f.heights.some((h) => h > 0 && h < 25)),
            'Height interpolates'
          )
        await auth.getByLabel('Western email', { exact: true }).click()
        await settled(null)
        await password.fill('Abc')
        await auth.locator('form').evaluate((form) => form.requestSubmit())
        await auth
          .getByText('Password must meet all requirements.', { exact: true })
          .waitFor()
        assert.equal(posts, 0)
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        await auth
          .getByRole('tab', { name: 'Log in', exact: true })
          .first()
          .click()
        await username.waitFor({ state: 'detached' })
        assert.equal(await passHelp.count(), 0)
        await page.keyboard.press('Escape')
        await auth.waitFor({ state: 'detached' })
        if (width === 390) {
          await page.setViewportSize({ width, height: 420 })
          await page
            .getByRole('button', { name: 'Log in', exact: true })
            .click()
          await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
          await username.click()
          await settled('username')
          await password.click()
          await settled('password')
          await page.waitForTimeout(700)
          assert(await auth.evaluate((e) => e.scrollHeight > e.clientHeight))
          assert.equal(await auth.getAttribute('data-scrolling'), null)
          const bounds = await auth.boundingBox()
          await page.mouse.move(
            bounds.x + bounds.width / 2,
            bounds.y + bounds.height / 2
          )
          const top = await auth.evaluate((e) => e.scrollTop)
          await page.mouse.wheel(0, 100)
          await page.waitForTimeout(150)
          assert((await auth.evaluate((e) => e.scrollTop)) > top)
          assert.notEqual(await auth.getAttribute('data-scrolling'), null)
          await page.waitForTimeout(700)
          assert.equal(await auth.getAttribute('data-scrolling'), null)
        }
        console.log(
          `PASS ${width}${
            reduced ? ' reduced' : ''
          }: contextual heights/fades, live rules, eye focus, four repeat cycles, retained values, invalid signup blocked, no overflow/page jump${
            width === 390 ? ', short-height scrolling/idle thumb' : ''
          }`
        )
        await page.close()
      }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
