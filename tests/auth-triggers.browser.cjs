// Trigger/surface regression with intercepted auth transport; no live mail.
/* global document, getComputedStyle */
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
      let signedIn = false
      let submitted = false
      const errors = []
      page.on('pageerror', (error) => errors.push(error.stack || error.message))
      await page.route('**/api/auth/**', async (route) => {
        const action = new URL(route.request().url()).pathname.split('/').pop()
        if (action === 'session')
          return route.fulfill({
            json: {
              seller: signedIn
                ? {
                    id: '11111111-1111-4111-8111-111111111111',
                    displayName: 'Test member',
                  }
                : null,
            },
          })
        if (action === 'sign-in') {
          submitted = true
          signedIn = true
        }
        return route.fulfill({ json: null })
      })
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame() && frame.url() === base + '/listings')
          assert(submitted, 'No navigation before auth POST succeeds')
      })
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      const login = page.getByRole('button', { name: 'Log in', exact: true })
      await login.click()
      await auth.waitFor()
      assert.equal(page.url(), base + '/')
      assert.equal(
        await auth.locator('#auth-title').innerText(),
        'Welcome back'
      )
      const surfaces = await auth.evaluate((dialog) => {
        const elements = [
          dialog.querySelector('#auth-title').parentElement,
          dialog.querySelector('form').parentElement,
          dialog.querySelector('section > p'),
        ]
        return elements.map((e) => ({
          width: e.getBoundingClientRect().width,
          background: getComputedStyle(e).backgroundColor,
          border: getComputedStyle(e).borderTopWidth,
        }))
      })
      assert(
        surfaces.every(
          (surface) =>
            surface.background !== 'rgba(0, 0, 0, 0)' &&
            surface.border === '1px'
        )
      )
      assert(surfaces.every((surface) => surface.width === surfaces[0].width))
      await page.screenshot({
        path: require('node:path').join(
          process.env.TEMP || '.',
          `campus-auth-stack-${width}.png`
        ),
      })
      await page.keyboard.press('Escape')
      await auth.waitFor({ state: 'detached' })
      const join =
        width < 1200
          ? page.getByRole('button', { name: 'Tear ticket to log in' })
          : page.getByRole('button', {
              name: 'Join Campus Marketplace',
              exact: true,
            })
      await join.waitFor()
      // Ticket deliberately floats continuously; use a real pointer click
      // without waiting for an animation-free bounding box.
      if (width < 1200)
        await join.locator('.tear-ticket__stub').click({ force: true })
      else {
        await join.focus()
        await page.keyboard.press('Enter')
      }
      await auth.waitFor()
      assert.equal(page.url(), base + '/')
      assert.equal(
        await auth.locator('#auth-title').innerText(),
        'Create your account'
      )
      await auth
        .getByRole('tab', { name: 'Log in', exact: true })
        .first()
        .click()
      await auth
        .getByLabel('Western email', { exact: true })
        .fill('modal-test@uwo.ca')
      await auth.getByLabel('Password', { exact: true }).fill('Password1!')
      await auth
        .getByRole('button', { name: 'Log in', exact: true })
        .last()
        .click()
      await auth.waitFor({ state: 'detached' })
      await page.waitForURL('**/listings', { waitUntil: 'domcontentloaded' })
      // Even a pre-existing session snapshot must not bypass an explicit Log in.
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await login.click()
      await auth.waitFor()
      assert.equal(page.url(), base + '/')
      await page.keyboard.press('Escape')
      await auth.waitFor({ state: 'detached' })
      signedIn = false
      await page.goto(base + '/', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-slot="expandable-card"]').click()
      const listing = page.getByRole('dialog').filter({
        has: page.getByRole('button', {
          name: 'Contact seller',
          exact: true,
        }),
      })
      await listing
        .getByRole('button', { name: 'Contact seller', exact: true })
        .click()
      await auth.waitFor()
      assert.equal(page.url(), base + '/')
      assert.equal(
        await auth.locator('#auth-title').innerText(),
        'Welcome back'
      )
      await auth
        .getByLabel('Western email', { exact: true })
        .fill('modal-test@uwo.ca')
      await auth.getByLabel('Password', { exact: true }).fill('Password1!')
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
      await login.click()
      await auth.waitFor()
      await auth.getByRole('tab', { name: 'Sign up', exact: true }).click()
      await page.setViewportSize({ width, height: 420 })
      await auth.locator('#auth-title').scrollIntoViewIfNeeded()
      assert(await auth.locator('#auth-title').isVisible())
      await auth
        .getByRole('button', { name: /^Create account/ })
        .scrollIntoViewIfNeeded()
      await auth.locator('section > p').scrollIntoViewIfNeeded()
      const dimensions = await auth.evaluate((e) => ({
        top: e.getBoundingClientRect().top,
        bottom: e.getBoundingClientRect().bottom,
        client: e.clientHeight,
        scroll: e.scrollHeight,
        pageLocked: getComputedStyle(document.body).overflow,
      }))
      assert(dimensions.top >= 0 && dimensions.bottom <= 420)
      assert(dimensions.scroll > dimensions.client)
      assert.equal(dimensions.pageLocked, 'hidden')
      assert.equal(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth >
            document.documentElement.clientWidth
        ),
        false
      )
      await page.keyboard.press('Escape')
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(
        `PASS ${width}: Log in and contact stay in place; ${
          width < 1200 ? 'Ticket' : 'Lanyard keyboard join'
        } opens signup; join navigates only after auth; contact retains listing without notice; aligned three surfaces and short-height scrolling.`
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
