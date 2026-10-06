/* global getComputedStyle, Navigator */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      await page.addInitScript(() => {
        delete Navigator.prototype.serviceWorker
      })
      const listing = {
        id: 'reference',
        title: 'Camera reference',
        price: 8500,
        currency: 'CAD',
        category: 'Electronics',
        subcategory: 'Cameras',
        condition: 'good',
        pickupArea: 'On campus',
        description: 'Works well.',
        photoUrls: ['/demo/reading-chair.jpg'],
        seller: { id: 'owner', displayName: 'Chris' },
        status: 'available',
        publishedAt: '2026-10-05',
        createdAt: '2026-10-05',
        updatedAt: '2026-10-05',
      }
      await page.route('**/api/**', (r) => {
        assert.equal(r.request().method(), 'GET', 'read-only fixture')
        const pathname = new URL(r.request().url()).pathname
        if (pathname === '/api/auth/session')
          return r.fulfill({ json: { seller: listing.seller } })
        if (pathname === '/api/listings') return r.fulfill({ json: [listing] })
        if (pathname === '/api/profile/account')
          return r.fulfill({
            json: {
              username: 'Chris',
              email: 'chris@uwo.ca',
              emailVerified: true,
              createdAt: '2026-10-01',
              nextUsernameChangeAt: null,
            },
          })
        return r.fulfill({ json: [] })
      })
      await page.goto('http://localhost:3100/home?section=my-listings', {
        waitUntil: 'networkidle',
      })
      const card = page.getByRole('article', {
        name: 'Camera reference',
        exact: true,
      })
      await card
        .locator('[data-slot="expandable-card"]')
        .click({ position: { x: 75, y: 50 } })
      const dialog = page.getByRole('dialog')
      await dialog.waitFor()
      await page.waitForTimeout(850)
      const reference = await dialog
        .getByRole('button', { name: 'Close', exact: true })
        .evaluate((button) => {
          const outer = button.getBoundingClientRect(),
            surface = button.firstElementChild,
            inner = surface.getBoundingClientRect()
          return {
            outerHeight: outer.height,
            height: inner.height,
            radius: getComputedStyle(surface).borderRadius,
            inset: inner.x - outer.x,
          }
        })
      assert.deepEqual(reference, {
        outerHeight: width >= 1024 ? 64 : 48,
        height: width >= 1024 ? 48 : 40,
        radius: '8px',
        inset: width >= 1024 ? 8 : 4,
      })
      console.log(
        'PASS',
        width,
        'actual ExpandedCard footer reference',
        reference
      )
      await dialog.getByRole('button', { name: 'Close', exact: true }).click()
      await dialog.waitFor({ state: 'detached' })
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
