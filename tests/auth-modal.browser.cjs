// UI/intent tests use intercepted auth responses. This is not live OTP acceptance.
/* global document, getComputedStyle, innerWidth */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
const base = process.env.BASE_URL || 'http://localhost:3100'
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
      })
      let loggedIn = false
      let rejectLogin = true
      let rejectCode = false
      const requests = []
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/api/auth/**', async (route) => {
        const action = new URL(route.request().url()).pathname.split('/').pop()
        requests.push(action)
        if (action === 'session')
          return route.fulfill({
            json: {
              seller: loggedIn
                ? {
                    id: '11111111-1111-4111-8111-111111111111',
                    displayName: 'Test member',
                  }
                : null,
            },
          })
        if (action === 'sign-in' && rejectLogin)
          return route.fulfill({
            status: 400,
            json: {
              error: 'Unable to sign in. Check your email and password.',
            },
          })
        if (action === 'verify-signup' && rejectCode)
          return route.fulfill({
            status: 400,
            json: {
              error: 'This code is incorrect or expired. Request another code.',
            },
          })
        if (['sign-in', 'verify-signup', 'reset-password'].includes(action))
          loggedIn = true
        return route.fulfill({ json: null })
      })
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      const login = page.getByRole('button', { name: 'Log in', exact: true })
      await login.click()
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await auth.waitFor()
      assert.equal(page.url(), base + '/')
      assert.equal(
        await auth.locator('#auth-title').innerText(),
        'Welcome back'
      )
      assert.equal(
        await page.evaluate(() => getComputedStyle(document.body).overflow),
        'hidden'
      )
      assert.equal(
        await page.evaluate(() => document.activeElement.getAttribute('name')),
        'email'
      )
      assert.equal(await auth.locator('input').count(), 2)
      assert.notEqual(
        await auth
          .locator('button[type=submit]')
          .evaluate((e) => getComputedStyle(e).backgroundColor),
        'rgba(0, 0, 0, 0)'
      )
      for (let i = 0; i < 12; i++) {
        await page.keyboard.press('Tab')
        assert(
          await page.evaluate(
            () =>
              document.activeElement
                .closest('dialog')
                ?.getAttribute('aria-labelledby') === 'auth-title'
          )
        )
      }
      const email = auth.getByLabel('Western email', { exact: true })
      const password = auth.getByLabel('Password', { exact: true })
      await email.fill('outside@example.com')
      await password.fill('Password1!')
      await auth
        .getByRole('button', { name: 'Log in', exact: true })
        .last()
        .click()
      await auth
        .getByRole('alert')
        .filter({ hasText: 'Use your Western email' })
        .waitFor()
      await email.fill('modal-test@uwo.ca')
      await auth
        .getByRole('button', { name: 'Log in', exact: true })
        .last()
        .click()
      await auth
        .getByRole('alert')
        .filter({ hasText: 'Check your email and password' })
        .waitFor()
      await auth.getByRole('button', { name: 'Show password' }).click()
      assert.equal(await password.getAttribute('type'), 'text')
      await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
      await auth
        .locator(
          'form[data-auth-mode="signup"] input[name="password"]:not(:disabled)'
        )
        .waitFor()
      await auth.getByLabel('Username', { exact: true }).fill('Test_member')
      assert.equal(await email.inputValue(), 'modal-test@uwo.ca')
      assert.equal(await auth.locator('input:not([type=checkbox])').count(), 4)
      await password.fill('Password1!')
      assert.equal(
        await auth
          .locator('[id$="-rules"] li')
          .filter({ hasText: '(satisfied)' })
          .count(),
        4
      )
      await auth.getByRole('button', { name: 'Send code', exact: true }).click()
      await auth.getByRole('alert').filter({ hasText: 'Agree to' }).waitFor()
      const agreement = auth.getByRole('checkbox')
      assert.equal(await agreement.isChecked(), false)
      await agreement.check()
      await auth
        .getByRole('button', { name: 'Read Community Standards' })
        .click()
      const standards = page.locator(
        'dialog[aria-labelledby="community-standards-title"]'
      )
      await standards.waitFor()
      await page.keyboard.press('Tab')
      assert(
        await standards.evaluate((e) => e.contains(document.activeElement))
      )
      await page.keyboard.press('Escape')
      await standards.waitFor({ state: 'detached' })
      assert.equal(await password.inputValue(), 'Password1!')
      assert.equal(await agreement.isChecked(), true)
      await auth.getByRole('button', { name: 'Send code', exact: true }).click()
      await auth
        .getByRole('status')
        .filter({ hasText: 'Verification code sent' })
        .waitFor()
      assert(await auth.getByRole('button', { name: /Resend in/ }).isDisabled())
      await auth.getByLabel('Verification code').fill('111111')
      rejectCode = true
      await auth.locator('form').evaluate((form) => form.requestSubmit())
      await auth
        .getByRole('alert')
        .filter({ hasText: 'incorrect or expired' })
        .waitFor()
      // Demonstrate full signup completion with an intercepted valid-code response.
      rejectCode = false
      await auth.locator('form').evaluate((form) => form.requestSubmit())
      await auth.waitFor({ state: 'detached' })
      await page.waitForURL('**/listings')
      loggedIn = false
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await login.click()
      await auth.getByRole('button', { name: 'Forgot password?' }).click()
      await auth
        .getByLabel('Western email', { exact: true })
        .fill('modal-test@uwo.ca')
      await auth.getByLabel('New password').fill('NewPassword1!')
      await auth.getByRole('button', { name: 'Send code', exact: true }).click()
      await auth
        .getByRole('status')
        .filter({ hasText: 'recovery code' })
        .waitFor()
      await page.keyboard.press('Escape')
      await auth.waitFor({ state: 'detached' })
      assert(await login.evaluate((e) => document.activeElement === e))
      assert.notEqual(
        await page.evaluate(() => getComputedStyle(document.body).overflow),
        'hidden'
      )
      // Auth above an existing expanded listing must preserve the listing dialog.
      await page.locator('[data-slot="expandable-card"]').click()
      const listing = page.getByRole('dialog').filter({
        has: page.getByRole('button', {
          name: 'Contact seller',
          exact: true,
        }),
      })
      await listing.waitFor()
      const contact = listing.getByRole('button', {
        name: 'Contact seller',
        exact: true,
      })
      await contact.click()
      await auth.waitFor()
      await page.keyboard.press('Escape')
      await auth.waitFor({ state: 'detached' })
      assert(await listing.isVisible())
      assert(await contact.evaluate((e) => document.activeElement === e))
      await contact.click()
      await auth
        .getByLabel('Western email', { exact: true })
        .fill('modal-test@uwo.ca')
      await auth.getByLabel('Password', { exact: true }).fill('Password1!')
      rejectLogin = false
      await auth
        .getByRole('button', { name: 'Log in', exact: true })
        .last()
        .click()
      await auth.waitFor({ state: 'detached' })
      assert.equal(page.url(), base + '/')
      assert(await listing.isVisible())
      assert.equal(await listing.getByRole('status').count(), 0)
      await page.keyboard.press('Escape')
      await listing.waitFor({ state: 'detached' })
      assert.notEqual(
        await page.evaluate(() => getComputedStyle(document.body).overflow),
        'hidden'
      )
      // Reopen with a fresh anonymous session and constrain height like a keyboard.
      loggedIn = false
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await login.click()
      await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
      await auth
        .locator(
          'form[data-auth-mode="signup"] input[name="password"]:not(:disabled)'
        )
        .waitFor()
      const geometry = await auth.evaluate((e) => ({
        width: e.getBoundingClientRect().width,
        client: e.clientHeight,
        scroll: e.scrollHeight,
        doc: document.documentElement.scrollWidth,
        viewport: innerWidth,
      }))
      assert(geometry.width <= width - 32)
      assert(geometry.doc <= geometry.viewport)
      await page.setViewportSize({ width, height: 420 })
      await auth
        .getByRole('button', { name: /^(Hold to create account|Create account)/ })
        .scrollIntoViewIfNeeded()
      assert(
        await auth.getByRole('button', { name: /^(Hold to create account|Create account)/ }).isVisible()
      )
      const short = await auth.evaluate((e) => ({
        client: e.clientHeight,
        scroll: e.scrollHeight,
        top: e.getBoundingClientRect().top,
        bottom: e.getBoundingClientRect().bottom,
      }))
      assert(short.scroll > short.client)
      assert(short.top >= 0 && short.bottom <= 420)
      await page.screenshot({
        path: require('node:path').join(
          process.env.TEMP || '.',
          `campus-auth-${width}.png`
        ),
      })
      await page.keyboard.press('Escape')
      await auth.waitFor({ state: 'detached' })
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(
        'PASS ' +
          width +
          'px: sign-in/signup/recovery UI, native focus/Escape, nested standards, scroll lock/restoration, auth intent, no overflow and short-height accessibility (mock auth). ' +
          JSON.stringify(geometry)
      )
      assert(
        requests.includes('signup-code') &&
          requests.includes('recover') &&
          requests.includes('verify-signup')
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
