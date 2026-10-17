/* global document, getComputedStyle */
const assert = require('node:assert/strict')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const viewWrites = []
      page.on('request', (request) => {
        if (request.url().endsWith('/api/listings/view'))
          viewWrites.push(request.url())
      })
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/auth/session', (r) =>
        r.fulfill({ json: { seller: null } })
      )
      await page.goto('http://localhost:3000/listings', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      const trail = page.getByRole('navigation', { name: 'Listing categories' })
      const tab = (name) =>
        page
          .locator('[data-discover]')
          .getByRole('button', { name, exact: true })
      await trail.waitFor()
      await page.evaluate(() => document.fonts.ready)
      assert.equal((await trail.innerText()).trim(), 'Resale')
      for (const root of ['Resale', 'Shop']) {
        await tab(root).click()
        assert.equal(
          (await trail.innerText()).replace(/\s+/g, ' ').trim(),
          root === 'Resale' ? 'Resale' : 'Shop \u203a All listings'
        )
        for (const [category, sub] of [
          ['Electronics', 'Computers & Tablets'],
          ['Clothing & Accessories', 'Shoes'],
          ['Home & Dorm', 'Lighting & Decor'],
        ]) {
          await page
            .getByRole('button', { name: 'Filter', exact: true })
            .click()
          await page
            .getByRole('combobox', { name: 'Category', exact: true })
            .click()
          await page
            .getByRole('option', { name: category, exact: true })
            .click()
          await page
            .getByRole('combobox', { name: 'Subcategory', exact: true })
            .click()
          await page.getByRole('option', { name: sub, exact: true }).click()
          await page
            .getByRole('button', { name: 'Confirm', exact: true })
            .click()
          await page
            .locator('[data-market-focus-backdrop]')
            .waitFor({ state: 'detached' })
          assert.match(
            await trail.innerText(),
            new RegExp(category + '\\s+\\u203a\\s+' + sub)
          )
          assert.equal(
            (await trail.locator('li').first().innerText()).trim(),
            root
          )
          const other = root === 'Resale' ? 'Shop' : 'Resale'
          await tab(other).click()
          assert.equal(
            (await trail.locator('li').first().innerText()).trim(),
            other
          )
          assert.equal(
            await trail.locator('[aria-current="page"]').innerText(),
            sub
          )
          await tab(root).click()
          assert.equal(
            await trail.getByRole('button', { name: sub, exact: true }).count(),
            0
          )
          const geometry = await trail.evaluate((el) => {
            const r = el.getBoundingClientRect()
            const cs = getComputedStyle(el)
            return {
              x: r.x,
              right: r.right,
              h: r.height,
              font: cs.fontSize,
              scroll: document.documentElement.scrollWidth,
              w: document.documentElement.clientWidth,
              items: [...el.querySelectorAll('li')].map((x) => {
                let b = x.getBoundingClientRect()
                return { y: b.y, bottom: b.bottom, right: b.right }
              }),
            }
          })
          assert.equal(geometry.h, 24)
          assert.equal(geometry.font, '13px')
          const toolbarBottom = await page
            .locator('[data-discover]')
            .evaluate((el) => el.getBoundingClientRect().bottom)
          const trailRect = await trail.boundingBox()
          assert(
            Math.abs(trailRect.y - toolbarBottom - 10) < 1,
            'toolbar to breadcrumb gap = 10px'
          )
          assert(geometry.scroll <= geometry.w)
          assert(geometry.items.every((x) => x.right <= geometry.right + 1))
          assert(
            geometry.items.every((x) => Math.abs(x.y - geometry.items[0].y) < 1)
          )
          await page.screenshot({
            path: `tests/artifacts/breadcrumb-${width}.png`,
          })
          await trail
            .getByRole('button', { name: category, exact: true })
            .click()
          assert.equal(
            await trail
              .getByRole('button', { name: category, exact: true })
              .count(),
            0
          )
          assert.equal(
            await trail.locator('[aria-current="page"]').innerText(),
            category
          )
          await trail.getByRole('button', { name: root, exact: true }).click()
          assert.equal(
            await trail.locator('[aria-current="page"]').innerText(),
            root === 'Resale' ? 'Resale' : 'All listings'
          )
        }
        // Clear using the existing Filter control as well as parent navigation.
        await page.getByRole('button', { name: 'Filter', exact: true }).click()
        await page
          .getByRole('combobox', { name: 'Category', exact: true })
          .click()
        await page
          .getByRole('option', { name: 'Electronics', exact: true })
          .click()
        await page.getByRole('button', { name: 'Confirm', exact: true }).click()
        await page
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
        assert.equal(
          await trail.locator('[aria-current="page"]').innerText(),
          'Electronics'
        )
        await page.getByRole('button', { name: 'Filter', exact: true }).click()
        await page
          .getByRole('combobox', { name: 'Category', exact: true })
          .click()
        await page
          .getByRole('option', { name: 'All categories', exact: true })
          .click()
        await page.getByRole('button', { name: 'Confirm', exact: true }).click()
        await page
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
        assert.equal(
          await trail.locator('[aria-current="page"]').innerText(),
          root === 'Resale' ? 'Resale' : 'All listings'
        )
        await page
          .getByRole('button', { name: 'Open search', exact: true })
          .click()
        await page
          .getByRole('combobox', { name: 'Search listings' })
          .fill('Electronics')
        await page
          .getByRole('option', { name: 'Electronics', exact: true })
          .click()
        await page
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
        assert.equal(
          await trail.locator('[aria-current="page"]').innerText(),
          'Electronics'
        )
        assert.equal(
          (await trail.locator('li').first().innerText()).trim(),
          root
        )
        await trail.getByRole('button', { name: root, exact: true }).click()
      }
      await tab('Resale').click()
      await page
        .locator('[data-market-feed="resale"][data-feed-present="true"]')
        .waitFor()
      await page.waitForFunction(() => {
        const e = document.querySelector('[data-market-feed="resale"]')
        return (
          e &&
          Math.abs(
            e.getBoundingClientRect().x -
              e.parentElement.getBoundingClientRect().x
          ) < 0.1
        )
      })
      const grid = page.locator('[data-market-grid]')
      if (await grid.count()) {
        const a = await trail.boundingBox(),
          b = await grid.boundingBox()
        assert(Math.abs(a.x - b.x) < 1)
        assert(
          Math.abs(b.y - (a.y + a.height) - 12) < 1,
          'breadcrumb to grid gap = 12px'
        )
      }
      await tab('Resale').click()
      assert.equal((await trail.innerText()).trim(), 'Resale')
      console.log(
        `${width}: Resale/Shop applied paths, tab preservation, parent/Filter clearing, 10px/12px gaps, 24px single line, grid alignment, no overflow PASS`
      )
      assert.deepEqual(
        viewWrites,
        [],
        'hydration, filters, search, tab switching and rerenders are not Listing Views'
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
