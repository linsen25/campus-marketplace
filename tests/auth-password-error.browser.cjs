// Signup error freshness and payload identity; no live emails/passwords logged.
/* global document */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' })
    const passwordMessage = 'Password does not meet the required security rules.'
    let responseError = passwordMessage
    let submitted
    await page.route('**/api/auth/**', (route) => {
      const action = new URL(route.request().url()).pathname.split('/').pop()
      if (action === 'session') return route.fulfill({ json: { seller: null } })
      if (action === 'username-availability') return route.fulfill({ json: { available: true } })
      if (action === 'signup-code') {
        submitted = route.request().postDataJSON().password
        return route.fulfill({ status: 400, json: { error: responseError } })
      }
      return route.fulfill({ json: null })
    })
    await page.goto(process.env.BASE_URL || 'http://localhost:3100', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Log in', exact: true }).click()
    const auth = page.locator('dialog[aria-labelledby="auth-title"]')
    await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
    await auth.locator('form[data-auth-mode="signup"]').waitFor()
    const password = auth.locator('[name="password"]')
    await auth.locator('[name="email"]').fill('test@uwo.ca')
    await auth.locator('[name="username"]').fill('Test_member')
    await password.fill('11111111A!')
    await auth.locator('[type="checkbox"]').check()
    const rules = await auth.locator('[id$="-rules"] li').allTextContents()
    assert.equal(rules.length, 4)
    assert(rules.every((text) => text.includes('(satisfied)')))
    assert(!rules.some((text) => text.includes('lowercase')))
    const submit = async () => {
      // Retry after the existing StatefulButton result interval; timing is unchanged.
      await page.waitForFunction(() => document.querySelector('dialog [data-state]').dataset.state === 'idle')
      const expected = await password.inputValue()
      await auth.getByRole('button', { name: /Send code/ }).click()
      await auth.getByRole('alert').filter({ hasText: responseError }).waitFor()
      assert.equal(submitted, expected, 'Current controlled value reaches request without changes')
    }
    await submit()
    await password.fill(' Abcdefg1! ')
    assert.equal(await auth.getByText(passwordMessage, { exact: true }).count(), 0)
    await submit()
    assert(await auth.getByText(passwordMessage, { exact: true }).isVisible(), 'New failure is displayed')
    for (const error of ['Network test failure', 'Use your Western email to continue.', 'That username is already taken.']) {
      responseError = error
      await submit()
      const before = await password.inputValue()
      await password.fill(before + 'A')
      assert(await auth.getByRole('alert').filter({ hasText: error }).isVisible(), 'Unrelated error remains')
    }
    console.log('PASS signup password: four rules without lowercase, current payload identity/no trimming, stale password error clears, retry error returns, unrelated network/email/username errors remain (mocked auth).')
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })
