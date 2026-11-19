/* global document, window, getComputedStyle */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of (process.env.TEST_WIDTHS || '390,768,834,1280,1536')
      .split(',')
      .map(Number)) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        hasTouch: true,
        serviceWorkers: 'block',
      })
      const requests = []
      let sendAttempts = 0
      let verifyAttempts = 0
      let loggedIn = false
      await page.route('**/api/auth/**', async (route) => {
        const url = new URL(route.request().url())
        const action = url.pathname.split('/').pop()
        if (action === 'session')
          return route.fulfill({
            json: {
              seller: loggedIn
                ? {
                    id: '11111111-1111-4111-8111-111111111111',
                    displayName: 'chris_25',
                  }
                : null,
            },
          })
        if (action === 'username-availability')
          return route.fulfill({
            json: {
              available:
                url.searchParams.get('username').toLowerCase() !== 'chris',
            },
          })
        const body = route.request().postDataJSON()
        requests.push({ action, body })
        if (action === 'signup-code') {
          await new Promise((resolve) => setTimeout(resolve, 350))
          if (++sendAttempts === 1)
            return route.fulfill({
              status: 400,
              json: {
                error: 'Unable to send a verification code. Please try again.',
              },
            })
        }
        if (action === 'verify-signup' && ++verifyAttempts === 1)
          return route.fulfill({
            status: 400,
            json: {
              error: 'This code is incorrect or expired. Request another code.',
            },
          })
        if (action === 'verify-signup') loggedIn = true
        return route.fulfill({ json: null })
      })
      loggedIn = false
      await page.goto(process.env.BASE_URL || 'http://localhost:3100', {
        timeout: 60000,
      })
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      await auth.waitFor()
      assert.equal(
        await auth.getByText('Usual & Unusual', { exact: true }).count(),
        0,
        'The auth heading must not duplicate the product brand'
      )
      assert.deepEqual(
        await auth
          .getByRole('button', { name: 'Close authentication' })
          .evaluate((button) => {
            const style = getComputedStyle(button)
            return {
              width: style.width,
              height: style.height,
              radius: style.borderRadius,
              border: style.borderTopWidth,
              background: style.backgroundColor,
            }
          }),
        {
          width: '36px',
          height: '36px',
          radius: '50%',
          border: '0px',
          background: 'rgba(0, 0, 0, 0)',
        }
      )
      assert.equal(
        await auth.locator('input[type="email"] + svg').count(),
        1,
        'Email input has a non-interactive mail affordance'
      )
      const modalSurface = await auth.locator('section').evaluate((surface) => {
        const style = getComputedStyle(surface)
        const header = surface.children[0]
        const formArea = surface.children[1]
        const verification = surface.children[2]
        return {
          width: surface.getBoundingClientRect().width,
          border: style.borderTopWidth,
          radius: style.borderRadius,
          headerBorder: getComputedStyle(header).borderTopWidth,
          formBorder: getComputedStyle(formArea).borderTopWidth,
          verificationBorder: getComputedStyle(verification).borderTopWidth,
          verificationText: verification.textContent,
          rootBackground: document.documentElement.style.backgroundColor,
        }
      })
      assert(modalSurface.width <= 460)
      assert.equal(modalSurface.border, '1px')
      assert.equal(modalSurface.radius, '16px')
      assert.equal(modalSurface.headerBorder, '0px')
      assert.equal(modalSurface.formBorder, '0px')
      assert.equal(modalSurface.verificationBorder, '1px')
      assert.match(modalSurface.verificationText, /Email verification required/)
      assert.match(modalSurface.verificationText, /personal or Western email/)
      assert.equal(modalSurface.rootBackground, 'rgb(12, 9, 18)')
      const geometry = await auth
        .getByRole('button', { name: 'Log in', exact: true })
        .evaluate((e) => {
          const a = e.getBoundingClientRect(),
            b = e.closest('form').getBoundingClientRect()
          const visible = e
            .querySelector('.shining-button__body')
            .getBoundingClientRect()
          return {
            center: Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2),
            width: Math.abs(a.width - b.width),
            height: getComputedStyle(e).height,
            visibleHeight: visible.height,
          }
        })
      assert(
        geometry.center < 1 && geometry.width < 1 && geometry.height === '58px',
        'Log in fills and aligns with its form'
      )
      assert.equal(
        geometry.visibleHeight,
        58,
        'Log in visible surface uses the Hold button height'
      )
      await auth.getByRole('button', { name: 'Log in', exact: true }).hover()
      await page.waitForTimeout(750)
      const loginHover = await auth
        .getByRole('button', { name: 'Log in', exact: true })
        .evaluate((button) => ({
          outerHeight: button.getBoundingClientRect().height,
          visibleHeight: button
            .querySelector('.shining-button__body')
            .getBoundingClientRect().height,
          arrowTransform: getComputedStyle(
            button.querySelector('.shining-button__arrow')
          ).transform,
        }))
      assert.equal(loginHover.outerHeight, 58)
      assert.equal(loginHover.visibleHeight, 58)
      assert.notEqual(
        loginHover.arrowTransform,
        'none',
        'Login keeps the shared arrow hover animation'
      )
      const login = auth.getByRole('tab', { name: 'Log in', exact: true })
      const signup = auth.getByRole('tab', { name: 'Sign up', exact: true })
      await login.focus()
      await page.keyboard.press('ArrowRight')
      assert(await signup.evaluate((e) => document.activeElement === e))
      assert.equal(
        await login.getAttribute('aria-selected'),
        'true',
        'Arrows only move focus'
      )
      await page.keyboard.press('Space')
      const username = auth.getByLabel('Username', { exact: true })
      const password = auth.getByLabel('Password', { exact: true })
      await username.waitFor()
      await login.click()
      await username.waitFor({ state: 'detached' })
      await signup.tap()
      await username.waitFor()
      await username.click()
      for (const value of [
        'ab',
        'chris 25',
        'chris-25',
        'chris!',
        'x'.repeat(21),
      ]) {
        await username.fill(value)
        await auth
          .getByText('Use 3–20 letters, numbers, or underscores.', {
            exact: true,
          })
          .waitFor()
      }
      for (const name of ['admin', 'ADMIN', 'Western', 'UWO']) {
        await username.fill(name)
        await auth
          .getByText('That username is reserved.', { exact: true })
          .waitFor()
      }
      await username.fill('Chris')
      await auth
        .getByText('That username is already taken.', { exact: true })
        .waitFor()
      await username.fill('chris')
      await auth
        .getByText('That username is already taken.', { exact: true })
        .waitFor()
      await username.fill('abc')
      await auth.getByText('Username is available.', { exact: true }).waitFor()
      await username.fill('chris_25')
      await auth.getByText('Username is available.', { exact: true }).waitFor()
      // CSS responsive variants share this one mounted selector and form state.
      await page.setViewportSize({
        width: width <= 1023 ? 1280 : 390,
        height: 900,
      })
      assert.equal(await username.inputValue(), 'chris_25')
      await page.setViewportSize({ width, height: 900 })
      const selector = await Promise.all(
        [login, signup].map(async (tab) =>
          tab.evaluate((e) => {
            const c = getComputedStyle(e)
            return {
              height: c.height,
              background: c.backgroundColor,
              border: c.borderTopColor,
              color: c.color,
              transform: c.transform,
              radius: c.borderRadius,
              font: c.fontSize,
              boxSizing: c.boxSizing,
              appearance: c.appearance,
              minHeight: c.minHeight,
              maxHeight: c.maxHeight,
              paddingTop: c.paddingTop,
              paddingBottom: c.paddingBottom,
            }
          })
        )
      )
      for (const tab of selector) {
        assert.equal(tab.height, '48px')
        assert.equal(tab.radius, '9999px')
        assert.equal(tab.font, '14px')
        assert.equal(tab.boxSizing, 'border-box')
        assert.equal(tab.appearance, 'none')
        assert.equal(tab.minHeight, '0px')
        assert.equal(tab.maxHeight, '48px')
        assert.equal(tab.paddingTop, '0px')
        assert.equal(tab.paddingBottom, '0px')
      }
      assert.deepEqual(selector[0], {
        ...selector[0],
        background: 'rgb(36, 28, 46)',
        border: 'rgb(89, 73, 97)',
        color: 'rgb(245, 242, 248)',
        transform: 'none',
      })
      assert.deepEqual(selector[1], {
        ...selector[1],
        background: 'rgb(124, 58, 237)',
        border: 'rgb(124, 58, 237)',
        color: 'rgb(255, 255, 255)',
        transform: 'none',
      })
      assert(
        await auth.evaluate((e) => e.scrollWidth <= e.clientWidth),
        'Auth selector has no horizontal overflow'
      )
      const signupControls = await auth.evaluate((dialog) => {
        const username = dialog.querySelector('input[name="signup-username"]')
        const usernameIcon = username?.parentElement?.querySelector('svg')
        const email = dialog.querySelector('input[type="email"]')
        const emailIcon = email?.parentElement?.querySelector('svg')
        const code = dialog.querySelector('input[name="code"]')
        const send = [...dialog.querySelectorAll('button')].find((button) =>
          /^(Send|Resend) code$/.test(button.textContent?.trim() ?? '')
        )
        return {
          usernameIcon: usernameIcon
            ? {
                ariaHidden: usernameIcon.getAttribute('aria-hidden'),
                height: getComputedStyle(usernameIcon).height,
                width: getComputedStyle(usernameIcon).width,
              }
            : null,
          emailIcon: emailIcon
            ? {
                height: getComputedStyle(emailIcon).height,
                width: getComputedStyle(emailIcon).width,
              }
            : null,
          codeHeight: code ? getComputedStyle(code).height : null,
          sendHeight: send ? getComputedStyle(send).height : null,
        }
      })
      assert.deepEqual(signupControls.usernameIcon, {
        ariaHidden: 'true',
        height: '18px',
        width: '18px',
      })
      assert.deepEqual(signupControls.usernameIcon, {
        ...signupControls.usernameIcon,
        ariaHidden: 'true',
        height: signupControls.emailIcon?.height,
        width: signupControls.emailIcon?.width,
      })
      assert.equal(signupControls.codeHeight, '48px')
      assert.equal(signupControls.sendHeight, signupControls.codeHeight)
      const signinRhythm = await auth.evaluate((dialog) => {
        const card = dialog.querySelector('section > div:nth-child(2)')
        const tabs = card.querySelector('[role="tablist"]')
        const email = dialog.querySelector('input[type="email"]')
        const password = dialog.querySelector('input[type="password"]')
        const submit = [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Log in'
        )
        const forgot = [...dialog.querySelectorAll('button')].find(
          (button) => button.textContent?.trim() === 'Forgot password?'
        )
        const privacy = dialog.querySelector('section > div:nth-child(3)')
        const emailField = email.closest('div[class]')?.parentElement
        const passwordField = password.closest('[data-help-field="password"]')
        const submitRow = submit.parentElement?.parentElement
        const forgotRow = forgot.parentElement
        const gap = (top, bottom) =>
          top.getBoundingClientRect().top -
          bottom.getBoundingClientRect().bottom
        return {
          tabsToEmail: gap(emailField, tabs),
          emailToPassword: gap(passwordField, emailField),
          passwordToSubmit: gap(submitRow, passwordField),
          submitToForgot: gap(forgotRow, submitRow),
          forgotToPrivacy: gap(privacy, forgotRow),
          shield: getComputedStyle(privacy.querySelector('svg')).width,
        }
      })
      assert(signinRhythm.tabsToEmail >= 24 && signinRhythm.tabsToEmail < 30)
      assert(
        signinRhythm.emailToPassword >= 20 && signinRhythm.emailToPassword < 28
      )
      assert(
        signinRhythm.passwordToSubmit >= 24 &&
          signinRhythm.passwordToSubmit < 30
      )
      assert(
        signinRhythm.submitToForgot >= 16 && signinRhythm.submitToForgot < 22
      )
      assert(
        signinRhythm.forgotToPrivacy >= 20 && signinRhythm.forgotToPrivacy < 28
      )
      assert.equal(signinRhythm.shield, '24px')
      for (const input of await auth
        .locator('input[type="email"], input[type="password"]')
        .all())
        assert.equal(
          await input.evaluate((e) => getComputedStyle(e).height),
          '48px'
        )
      await password.fill('Abcdefg1!')
      const labels = await auth
        .locator('[id$="-rules"] li')
        .evaluateAll((elements) =>
          elements.map((e) =>
            [...e.childNodes]
              .filter((n) => n.nodeType === 3)
              .map((n) => n.textContent.trim())
              .join('')
          )
        )
      assert.deepEqual(labels, [
        '8+ characters',
        '1 uppercase letter',
        '1 number',
        '1 symbol',
      ])
      const hold = auth.getByRole('button', {
        name: /^(Hold to create account|Create account)/,
      })
      assert(
        await hold
          .getByText('Hold to create account', { exact: true })
          .first()
          .isVisible()
      )
      assert.equal(
        await hold.evaluate((e) => getComputedStyle(e).borderTopWidth),
        '1px'
      )
      const holdGeometry = await hold.evaluate((e) => {
        const button = e.getBoundingClientRect()
        const form = e.closest('form').getBoundingClientRect()
        return {
          height: getComputedStyle(e).height,
          width: Math.abs(button.width - form.width),
          center: Math.abs(
            (button.left + button.right) / 2 - (form.left + form.right) / 2
          ),
        }
      })
      assert.equal(holdGeometry.height, '58px')
      assert.equal(holdGeometry.height, `${geometry.visibleHeight}px`)
      assert(holdGeometry.width < 1 && holdGeometry.center < 1)
      assert.equal(
        await hold.evaluate((e) => getComputedStyle(e).backgroundColor),
        'rgb(124, 58, 237)'
      )
      await hold.focus()
      await page.keyboard.down('Enter')
      await page.waitForTimeout(150)
      await page.keyboard.up('Enter')
      assert.equal(requests.length, 0, 'Short release does not submit')
      await password.fill('Abc')
      await hold.focus()
      await page.keyboard.down('Space')
      await page.waitForTimeout(1150)
      await page.keyboard.up('Space')
      await auth
        .getByText('Password must meet all requirements.', { exact: true })
        .waitFor()
      assert.equal(requests.length, 0, 'Hold cannot bypass validation')
      await page.waitForTimeout(1300)
      await auth
        .getByLabel('Western email', { exact: true })
        .fill('auth-components@uwo.ca')
      await password.fill('Abcdefg1!')
      await auth.getByRole('checkbox').check()
      assert(
        await auth
          .getByText('I agree to the Marketplace rules', { exact: true })
          .isVisible()
      )
      const send = auth.locator('button[data-state]')
      await send.click()
      await send.locator('[data-state]').count()
      await page.waitForFunction(
        () =>
          document.querySelector(
            'dialog[aria-labelledby="auth-title"] button[data-state]'
          )?.dataset.state === 'loading'
      )
      await auth
        .getByText('Unable to send a verification code. Please try again.', {
          exact: true,
        })
        .waitFor()
      assert.equal(await send.getAttribute('data-state'), 'error')
      assert(await send.isEnabled())
      await send.click()
      await page.waitForFunction(
        () =>
          document.querySelector(
            'dialog[aria-labelledby="auth-title"] button[data-state]'
          )?.dataset.state === 'success'
      )
      assert.equal(sendAttempts, 2)
      assert.equal(requests.at(-1).body.username, 'chris_25')
      assert(
        await username.isDisabled(),
        'Reserved username remains bound to code'
      )
      await auth.getByLabel('Verification code', { exact: true }).fill('123456')
      await hold.focus()
      await page.keyboard.down('Enter')
      await page.waitForTimeout(1150)
      await page.keyboard.up('Enter')
      await auth
        .getByText('This code is incorrect or expired. Request another code.', {
          exact: true,
        })
        .waitFor()
      assert.equal(verifyAttempts, 1)
      await page.waitForTimeout(1300)
      await auth.getByLabel('Verification code', { exact: true }).fill('654321')
      await password.click()
      await page.waitForTimeout(300)
      await hold.scrollIntoViewIfNeeded()
      const box = await hold.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      assert.equal(
        await hold.getAttribute('data-phase'),
        'holding',
        JSON.stringify({ box, disabled: await hold.isDisabled() })
      )
      await page.waitForTimeout(1150)
      await page.mouse.up()
      await page.waitForTimeout(250)
      assert.equal(verifyAttempts, 2, 'Complete pointer hold submits once')
      await auth.waitFor({ state: 'detached' })
      assert.equal(verifyAttempts, 2, 'Each complete hold submits exactly once')
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      // Re-open from the listing to verify bubbling keyboard events still isolate it.
      await page.goto(process.env.BASE_URL || 'http://localhost:3100', {
        timeout: 60000,
      })
      await page.locator('[data-slot="expandable-card"]').click()
      const contact = page.getByRole('button', {
        name: 'Contact seller',
        exact: true,
      })
      await contact.waitFor()
      await page.waitForTimeout(700)
      const before = await page.evaluate(() => window.scrollY)
      const originalUrl = page.url()
      for (const dismiss of ['X', 'Escape', 'backdrop']) {
        await contact.click()
        await auth.waitFor()
        assert.equal(page.url(), originalUrl)
        if (dismiss === 'X')
          await auth
            .getByRole('button', { name: 'Close authentication' })
            .click()
        else if (dismiss === 'Escape') await page.keyboard.press('Escape')
        else await page.mouse.click(2, 2)
        await auth.waitFor({ state: 'detached' })
        assert.equal(page.url(), originalUrl)
        assert(
          Math.abs((await page.evaluate(() => window.scrollY)) - before) <= 1
        )
        assert(await contact.evaluate((e) => document.activeElement === e))
      }
      console.log(
        `PASS ${width}: Shift Tabs keyboard/tap/click, username format/availability, exact password copy, real promise failure/retry/success visuals, keyboard/pointer hold once + cancellation + retry, and Contact context/focus/scroll dismissal.`
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
