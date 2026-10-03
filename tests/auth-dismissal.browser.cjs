// Logged-out routing/dismissal regression; no live authentication or email.
/* global document */
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
        reducedMotion: 'reduce',
        serviceWorkers: 'block',
      })
      await page.route('**/api/auth/session', (route) =>
        route.fulfill({ json: { seller: null } })
      )
      await page.goto(base + '/', { waitUntil: 'load' })
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      const home = page.locator('#welcome-title')
      const login = page.getByRole('button', { name: 'Log in', exact: true })
      const join =
        width < 1200
          ? page.getByRole('button', { name: 'Tear ticket to log in' })
          : page.getByRole('button', {
              name: 'Join Campus Marketplace',
              exact: true,
            })
      const listing = page.getByRole('dialog').filter({
        has: page.getByRole('button', { name: 'Contact seller', exact: true }),
      })
      const contact = listing.getByRole('button', {
        name: 'Contact seller',
        exact: true,
      })
      const navigations = []
      page.on('framenavigated', (frame) => {
        if (frame === page.mainFrame()) navigations.push(frame.url())
      })
      for (const source of ['login', 'join', 'contact']) {
        if (source === 'contact') {
          await page.locator('[data-slot="expandable-card"]').click()
          await contact.waitFor()
        }
        for (const method of ['X', 'Escape', 'backdrop']) {
          const before = page.url()
          if (source === 'login') await login.click()
          else if (source === 'contact') await contact.click()
          else if (width < 1200)
            await join.locator('.tear-ticket__stub').click({ force: true })
          else {
            await join.focus()
            await page.keyboard.press('Enter')
          }
          await auth.waitFor()
          assert.equal(page.url(), before, 'Opening must not change route')
          assert.equal(
            await auth.locator('#auth-title').innerText(),
            source === 'join' ? 'Create your account' : 'Welcome back'
          )
          if (method === 'X')
            await auth
              .getByRole('button', { name: 'Close authentication' })
              .click()
          else if (method === 'Escape') await page.keyboard.press('Escape')
          else await page.mouse.click(2, 2)
          await auth.waitFor({ state: 'detached' })
          assert.equal(page.url(), before, 'Dismissal must not change route')
          assert(await home.isVisible(), 'Original Welcome remains mounted')
          if (source === 'contact') {
            assert(await listing.isVisible(), 'Original listing stays open')
            assert(
              await contact.evaluate((e) => document.activeElement === e),
              'Contact regains focus'
            )
          } else {
            assert.equal(await listing.count(), 0)
            assert(
              await (source === 'login' ? login : join).evaluate(
                (e) => document.activeElement === e
              ),
              'Welcome trigger regains focus'
            )
          }
          assert(
            navigations.every((url) => url === before),
            `No transient legacy navigation: ${JSON.stringify(navigations)}`
          )
          console.log(
            `PASS ${width} ${source} ${method}: ${before} -> open -> ${page.url()}; original context and focus restored`
          )
        }
        if (source === 'contact') {
          await page.keyboard.press('Escape')
          await listing.waitFor({ state: 'detached' })
        }
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
