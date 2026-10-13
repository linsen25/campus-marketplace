/* global document, window */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')

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
        hasTouch: width < 1024,
        serviceWorkers: 'block',
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route('**/api/auth/session', (route) =>
        route.fulfill({ json: { seller: null } })
      )
      await page.goto(
        (process.env.BASE_URL || 'http://localhost:3000') + '/listings',
        { waitUntil: 'domcontentloaded', timeout: 120000 }
      )
      await page.locator('[data-market-card]').first().waitFor()
      const listings = await page.evaluate(
        () =>
          JSON.parse(document.getElementById('__NEXT_DATA__').textContent).props
            .pageProps.listings
      )
      const multiple = listings.find((listing) => listing.photoUrls.length > 1)
      const single = listings.find((listing) => listing.photoUrls.length === 1)
      assert(
        multiple,
        'Read-only staging dataset must contain a multi-image Listing'
      )
      assert(
        single,
        'Read-only staging dataset must contain a single-image Listing'
      )
      for (const listing of [multiple, single]) {
        const card = page
          .locator('[data-market-card]')
          .filter({ has: page.getByAltText(listing.title, { exact: true }) })
          .first()
        const trigger = card.locator('[data-slot="expandable-card"]')
        const before = await trigger.boundingBox()
        await trigger.hover()
        assert.equal(
          await trigger.locator('[data-slot="image-slider"]').count(),
          0
        )
        assert.equal(
          await trigger.getByRole('button', { name: /slide/i }).count(),
          0
        )
        assert.equal(
          await trigger.locator('img').getAttribute('src'),
          listing.photoUrls[0]
        )
        await trigger.click()
        const dialog = page.locator(
          '[data-slot="listing-overlay"] [role="dialog"]'
        )
        await dialog.waitFor({ state: 'visible' })
        if (listing.photoUrls.length > 1) {
          const slide = (index) =>
            dialog.getByRole('group', {
              name: `${index} of ${listing.photoUrls.length}`,
              exact: true,
            })
          await slide(1).waitFor()
          await dialog
            .getByRole('button', { name: 'Next slide', exact: true })
            .click()
          await slide(2).waitFor()
          await dialog
            .getByRole('button', { name: 'Previous slide', exact: true })
            .click()
          await slide(1).waitFor()
          if (width < 1024) {
            const media = await dialog
              .locator('[data-slot="image-slider"]')
              .boundingBox()
            const touch = await page.context().newCDPSession(page)
            const y = media.y + media.height / 2
            await touch.send('Input.dispatchTouchEvent', {
              type: 'touchStart',
              touchPoints: [{ x: media.x + media.width * 0.75, y }],
            })
            await touch.send('Input.dispatchTouchEvent', {
              type: 'touchMove',
              touchPoints: [{ x: media.x + media.width * 0.25, y }],
            })
            await touch.send('Input.dispatchTouchEvent', {
              type: 'touchEnd',
              touchPoints: [],
            })
            await touch.detach()
            await slide(2).waitFor()
          } else {
            await dialog
              .getByRole('button', { name: 'Next slide', exact: true })
              .click()
            await slide(2).waitFor()
          }
        } else {
          assert.equal(
            await dialog.getByRole('button', { name: /slide/i }).count(),
            0
          )
        }
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
        await page.waitForTimeout(500)
        assert.equal(
          await trigger.locator('img').getAttribute('src'),
          listing.photoUrls[0]
        )
        assert.equal(
          await trigger.locator('[data-slot="image-slider"]').count(),
          0
        )
        assert.deepEqual(
          await trigger.boundingBox(),
          before,
          'Card dimensions unchanged after closing'
        )
        await trigger.click()
        await dialog.waitFor({ state: 'visible' })
        if (listing.photoUrls.length > 1)
          await dialog
            .getByRole('group', {
              name: `1 of ${listing.photoUrls.length}`,
              exact: true,
            })
            .waitFor()
        await dialog.getByRole('button', { name: 'Close', exact: true }).click()
        await dialog.waitFor({ state: 'detached' })
      }
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: first-image-only collapsed, expanded arrows${
          width < 1024 ? '/touch swipe' : ''
        }, close/reopen reset, single-image no controls, unchanged card geometry, no runtime errors`
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
