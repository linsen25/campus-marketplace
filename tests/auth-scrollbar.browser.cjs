// Auth viewport thumb visibility only; mocked session, no live auth requests.
/* global document, getComputedStyle */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [1280, 1536, 390, 768, 834]) {
      // Above the old 700px height cutoff, so desktop exercises the regression.
      const page = await browser.newPage({
        viewport: { width, height: 720 }, serviceWorkers: 'block',
      })
      await page.route('**/api/auth/session', (route) => route.fulfill({ json: { seller: null } }))
      await page.goto(process.env.BASE_URL || 'http://localhost:3100', { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      const inspect = () => auth.evaluate((element) => ({
        color: getComputedStyle(element).scrollbarColor,
        thumb: getComputedStyle(element, '::-webkit-scrollbar-thumb').backgroundColor,
        overflow: getComputedStyle(element).overflowY,
        gutter: getComputedStyle(element).scrollbarGutter,
        width: element.clientWidth,
        height: element.clientHeight,
        contentHeight: element.scrollHeight,
        top: element.scrollTop,
      }))
      const hidden = async () => {
        await page.waitForFunction(() => !document.querySelector('dialog[aria-labelledby="auth-title"]').hasAttribute('data-scrolling'))
        const state = await inspect()
        assert.equal(state.color, 'rgba(0, 0, 0, 0) rgba(0, 0, 0, 0)')
        assert.equal(state.thumb, 'rgba(0, 0, 0, 0)')
        assert.equal(state.overflow, 'auto')
        return state
      }
      const signup = async () => {
        await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
        await auth.locator('form[data-auth-mode="signup"]').waitFor()
        await page.waitForTimeout(800)
      }
      await signup()
      await hidden()
      await page.waitForTimeout(2200)
      await hidden()
      // Existing contextual validation supplies genuine overflow, not fake content.
      await auth.getByRole('group', { name: 'Create account requirements' }).focus()
      await page.keyboard.press('Enter')
      await page.waitForTimeout(800)
      const initial = await hidden()
      assert(initial.contentHeight > initial.height, 'Real signup helper content overflows')
      for (let cycle = 0; cycle < 3; cycle++) {
        await auth.hover()
        await page.mouse.wheel(0, cycle % 2 ? -100 : 100)
        await page.waitForFunction(() => document.querySelector('dialog[aria-labelledby="auth-title"]').hasAttribute('data-scrolling'))
        const active = await inspect()
        assert.equal(active.color, 'rgb(245, 245, 245) rgba(0, 0, 0, 0)')
        assert.equal(active.thumb, 'rgb(245, 245, 245)')
        assert.equal(active.width, initial.width)
        assert.equal(active.gutter, initial.gutter)
        await page.waitForTimeout(750)
        await hidden()
      }
      await auth.getByRole('tab', { name: 'Log in', exact: true }).click()
      await auth.locator('form[data-auth-mode="signin"]').waitFor()
      await signup()
      await hidden()
      await auth.locator('[name="password"]').focus()
      await page.waitForTimeout(800)
      await hidden()
      console.log(`PASS ${width}: initial/idle transparent, real overflow scrolls with white thumb, 3 idle resets, mode/helper changes, unchanged width/gutter`)
      await page.close()
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
