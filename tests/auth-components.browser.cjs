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
      const geometry = await auth.getByRole('button',{name:'Log in',exact:true}).evaluate(e=>{
        const a=e.getBoundingClientRect(), b=e.parentElement.getBoundingClientRect()
        return Math.abs((a.left+a.right)/2-(b.left+b.right)/2)
      })
      assert(geometry<1,'Log in is centered within its unchanged action sizing wrapper')
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
      for(const name of ['admin','ADMIN','Western','UWO']) {
        await username.fill(name)
        await auth.getByText('That username is reserved.',{exact:true}).waitFor()
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
      await page.setViewportSize({width:width <= 1023 ? 1280 : 390,height:900})
      assert.equal(await username.inputValue(),'chris_25')
      await page.setViewportSize({width,height:900})
      const selector = await login.evaluate((e) => {
        const f=e.firstElementChild, c=getComputedStyle(e), face=getComputedStyle(f)
        return {height:c.height,bg:c.backgroundColor,bottom:c.borderBottomColor,faceBg:face.backgroundColor,transform:face.transform,radius:c.borderRadius,padding:c.padding,font:getComputedStyle(f.firstElementChild).fontSize}
      })
      if(width <=1023) {
        assert.equal(selector.height,width<768?'48px':'64px')
        assert.equal(selector.radius,'12px')
        assert.equal(selector.font,'14px')
        await login.hover()
        assert.equal(await login.locator(':scope > span').evaluate(e=>getComputedStyle(e).transform),'none')
      } else {
        assert.equal(selector.bg,'rgba(0, 0, 0, 0)') // Log in is inactive
        await login.hover()
        await page.waitForTimeout(240)
        assert.equal(await login.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(196, 163, 92)')
        assert.equal(await signup.evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(196, 163, 92)')
        assert.equal(await signup.locator(':scope > span').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(36, 28, 46)')
      }
      assert(await auth.evaluate(e=>e.scrollWidth<=e.clientWidth),'Auth selector has no horizontal overflow')
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
      const hold = auth.getByRole('button', { name: /^(Hold to create account|Create account)/ })
      assert(await hold.getByText('Hold to create account',{exact:true}).first().isVisible())
      assert.equal(await hold.evaluate(e=>getComputedStyle(e).borderTopWidth),'1px')
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
