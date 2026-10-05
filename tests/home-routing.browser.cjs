/* global location, performance */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const browser = await chromium.launch({ executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true, args: ['--enable-unsafe-swiftshader'] })
  try {
    for (const width of [390, 834, 1280, 1536]) {
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort())
      let signedIn = false
      let submits = 0
      await page.route('**/api/auth/**', (route) => {
        const action = new URL(route.request().url()).pathname.split('/').pop()
        if (action === 'session') return route.fulfill({ json: {
          seller: signedIn ? { id: 'routing-test', displayName: 'Tester' } : null,
        } })
        if (action === 'sign-in') { signedIn = true; submits++ }
        return route.fulfill({ json: null })
      })
      // Keep navigation deterministic without a live catalog/database request.
      await page.route('**/_next/data/**/listings.json*', (route) => route.fulfill({ json: {
        pageProps: { listings: [], values: { status: 'active', sort: 'newest', search: '', category: '', condition: '' },
          page: 1, hasNextPage: false, error: null }, __N_SSP: true,
      } }))
      const homeOnlyNodes = page.locator('[data-slot="home-sidebar-demo"], [data-slot="sidebar"], [data-home-background]')
      const noPersonalShell = async () => {
        assert.equal(await homeOnlyNodes.count(), 0)
        assert.equal(await page.locator('[data-slot="home-shell"]').count(), 0)
      }
      const capture = async (name) => {
        const session = await page.context().newCDPSession(page)
        const shot = await session.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false })
        fs.writeFileSync(`${process.env.TEMP}/home-routing-${width}-${name}.png`, Buffer.from(shot.data, 'base64'))
        await session.detach()
      }
      await page.goto('http://localhost:3100/', { waitUntil: 'domcontentloaded', timeout: 120000 })
      await page.locator('#welcome-title').waitFor()
      await noPersonalShell()
      await page.getByRole('button', { name: 'Log in', exact: true }).click()
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await auth.waitFor()
      await noPersonalShell()
      await auth.locator('#login-email').fill('tester@uwo.ca')
      await auth.locator('#login-password').fill('Abcdefg1!')
      const started = await page.evaluate(() => performance.now())
      await auth.getByRole('button', { name: 'Log in', exact: true }).click()
      await page.waitForURL('**/listings', { timeout: 60000, waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await auth.waitFor({ state: 'detached' })
      await page.waitForTimeout(1000)
      const elapsed = await page.evaluate((start) => performance.now() - start, started)
      assert.equal(submits, 1)
      await noPersonalShell()
      assert.equal(await page.locator('[data-market-card]').count() >= 15, true)
      const tabs = page.getByRole('navigation', { name: 'Home and Market navigation' })
      if (width < 1024) {
        await tabs.getByRole('tab', { name: 'Market', exact: true }).waitFor()
        assert.equal(await tabs.getByRole('tab', { name: 'Market', exact: true }).getAttribute('aria-selected'), 'true')
        await tabs.getByRole('tab', { name: 'Home', exact: true }).click()
      } else {
        const home = page.getByRole('navigation', { name: 'Market navigation' }).getByRole('link', { name: 'Home', exact: true })
        assert.equal(await home.getAttribute('href'), '/home')
        await home.click()
      }
      await page.waitForFunction(() => location.pathname === '/home')
      await page.locator('[data-slot="home-sidebar-demo"]').waitFor()
      await page.waitForTimeout(500)
      assert.equal(await page.locator('[data-slot="home-shell"]').count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'My Account', exact: true }).count(), 0)
      assert.equal(await page.getByRole('heading', { name: 'Overview', exact: true }).count(), 1)
      await capture('home')
      if (width < 1024) {
        assert.equal(await tabs.getByRole('tab', { name: 'Home', exact: true }).getAttribute('aria-selected'), 'true')
        await tabs.getByRole('tab', { name: 'Market', exact: true }).click()
      } else {
        const rail = page.locator('[data-slot="sidebar-body"]')
        await rail.getByRole('link', { name: 'Back to Market', exact: true }).click()
      }
      await page.waitForFunction(() => location.pathname === '/listings')
      await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await noPersonalShell()
      await page.waitForTimeout(500)
      await capture('market')
      if (width < 1024) {
        assert.equal(await tabs.getByRole('tab', { name: 'Market', exact: true }).getAttribute('aria-selected'), 'true')
        // Reload/direct visit selects Home from the URL rather than local state.
        await page.goto('http://localhost:3100/home', { waitUntil: 'domcontentloaded' })
        await tabs.getByRole('tab', { name: 'Home', exact: true }).waitFor()
        assert.equal(await tabs.getByRole('tab', { name: 'Home', exact: true }).getAttribute('aria-selected'), 'true')
      }
      for (const path of ['/account', '/account/favorites', '/account/messages', '/account/profile', '/account/settings']) {
        const response = await page.goto(`http://localhost:3100${path}`, { waitUntil: 'domcontentloaded' })
        assert.equal(response.status(), 404)
        await noPersonalShell()
        assert.equal(await page.getByRole('heading', { name: 'My Account', exact: true }).count(), 0)
      }
      assert.deepEqual(errors, [])
      console.log(`PASS ${width}: Welcome/auth have no personal shell; mocked login→Market (${Math.round(elapsed)}ms including reveal/wait); Market→Home→Market; pathname selection/direct Home; all retired routes 404; no browser errors`)
      await page.close()
    }
  } finally { await browser.close() }
})().catch((error) => { console.error(error); process.exitCode = 1 })

