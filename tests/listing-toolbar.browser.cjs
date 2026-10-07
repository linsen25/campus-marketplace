/* global document, window, getComputedStyle, Navigator */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const listing = (
  id,
  price,
  status = 'available',
  category = 'Electronics',
  seller = 'owner'
) => ({
  id,
  title: id,
  price,
  status,
  category,
  subcategory: category === 'Electronics' ? 'Cameras' : 'Furniture',
  condition: 'good',
  pickupArea: 'On campus',
  currency: 'CAD',
  description: 'Toolbar verification fixture.',
  photoUrls: ['/demo/reading-chair.jpg'],
  seller: { id: seller, displayName: 'Fixture' },
  publishedAt: '2026-10-05',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
  expectedImageCount: 1,
})
;(async () => {
  const output = path.join(process.env.TEMP, 'listing-toolbar-checks')
  fs.mkdirSync(output, { recursive: true })
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
      // Disable PWA registration in this isolated fixture; blocked registration
      // otherwise returns undefined to the existing next-pwa production handler.
      await page.addInitScript(() => {
        delete Navigator.prototype.serviceWorker
      })
      const errors = [],
        writes = [],
        favoriteQueries = []
      const own = [
        listing('Active expensive', 9000),
        listing('Active cheap', 1000),
        listing('Active furniture', 3000, 'available', 'Home & Dorm'),
        listing('Sold expensive', 7000, 'sold'),
        listing('Sold cheap', 500, 'sold'),
        { ...listing('Unpublished', 0), publishedAt: null },
      ]
      const favorites = [
        listing(
          'Favorite expensive',
          5000,
          'available',
          'Electronics',
          'other'
        ),
        listing('Favorite cheap', 1000, 'available', 'Electronics', 'other'),
        listing('Favorite sold', 0, 'sold', 'Electronics', 'other'),
      ]
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/**', (r) => {
        const request = r.request(),
          url = new URL(request.url())
        const send = (json) => r.fulfill({ json })
        if (request.method() !== 'GET') {
          writes.push(url.pathname)
          return r.fulfill({
            status: 501,
            json: { error: 'Writes prohibited' },
          })
        }
        if (url.pathname === '/api/auth/session')
          return send({ seller: { id: 'owner', displayName: 'Fixture' } })
        if (url.pathname === '/api/profile/account')
          return send({
            username: 'Fixture',
            email: 'fixture@uwo.ca',
            emailVerified: true,
            createdAt: '2026-10-01',
            nextUsernameChangeAt: null,
          })
        if (url.pathname === '/api/profile/categories') return send([])
        if (url.pathname === '/api/listings')
          return send(url.searchParams.has('mine') ? own : [])
        if (url.pathname === '/api/favorites') {
          favoriteQueries.push(url.search)
          const rows = favorites.filter(
            (item) =>
              !url.searchParams.get('category') ||
              item.category === url.searchParams.get('category')
          )
          if (url.searchParams.get('sort') === 'price-asc')
            rows.sort((a, b) => a.price - b.price)
          return send(rows)
        }
        if (url.pathname.startsWith('/api/favorites/'))
          return send({ favorited: false })
        return r.fulfill({
          status: 501,
          json: { error: 'Unexpected verification request' },
        })
      })
      const inspect = async (name) => {
        const sort = page.getByRole('button', { name: 'Sort', exact: true })
        const filter = page.getByRole('button', { name: 'Filter', exact: true })
        await sort.waitFor({ state: 'visible' })
        await filter.waitFor({ state: 'visible' })
        const geometry = await Promise.all([
          sort.boundingBox(),
          filter.boundingBox(),
        ])
        assert.equal(geometry[0].y, geometry[1].y)
        assert.equal(geometry[0].height, 48)
        assert.equal(geometry[1].height, geometry[0].height)
        const buttons = await Promise.all(
          [sort, filter].map((node) =>
            node.evaluate((el) => {
              const s = getComputedStyle(el)
              return {
                height: s.height,
                radius: s.borderRadius,
                border: s.border,
                background: s.backgroundColor,
                color: s.color,
                font: s.font,
                padding: s.padding,
                gap: s.gap,
                align: s.alignItems,
              }
            })
          )
        )
        const group = await sort.evaluate((el) => {
          const s = getComputedStyle(el.closest('[data-market-controls]'))
          return { gap: s.gap, align: s.alignItems }
        })
        await sort.click()
        await page.waitForTimeout(250)
        const backdrop = page.locator('[data-market-focus-backdrop]')
        await backdrop.waitFor()
        const surface = await backdrop.evaluate((el) => {
          const s = getComputedStyle(el)
          return {
            blur: s.backdropFilter,
            background: s.backgroundColor,
            opacity: s.opacity,
          }
        })
        assert.equal(surface.blur, 'blur(4px)')
        assert.equal(surface.background, 'rgba(15, 10, 22, 0.18)')
        const panel = await page
          .getByRole('region', { name: 'Sort options', exact: true })
          .evaluate((el) => {
            const s = getComputedStyle(el)
            return {
              background: s.backgroundColor,
              border: s.border,
              radius: s.borderRadius,
            }
          })
        await page.screenshot({
          path: path.join(output, `${width}-${name}-sort.png`),
        })
        await page.keyboard.press('Escape')
        await backdrop.waitFor({ state: 'detached' })
        await filter.click()
        await page.waitForTimeout(250)
        await page.screenshot({
          path: path.join(output, `${width}-${name}-filter.png`),
        })
        await page.keyboard.press('Escape')
        await backdrop.waitFor({ state: 'detached' })
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        return { buttons, group, surface, panel }
      }
      await page.goto(
        (process.env.HOME_TEST_URL || 'http://localhost:3100') + '/listings',
        {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        }
      )
      const market = await inspect('market')
      await page.goto(
        (process.env.HOME_TEST_URL || 'http://localhost:3100') +
          '/home?section=my-listings',
        {
          waitUntil: 'domcontentloaded',
        }
      )
      const workspace = page.getByRole('region', {
        name: 'My Listings',
        exact: true,
      })
      await workspace
        .getByRole('article', { name: 'Active expensive', exact: true })
        .waitFor()
      const ownStyles = await inspect('my-listings')
      assert.deepEqual(
        ownStyles,
        market,
        'Actual computed styling equals Market, including the blurred focus surface'
      )
      const boxes = await Promise.all(
        ['Active', 'Sold'].map((name) =>
          workspace.getByRole('tab', { name, exact: true }).boundingBox()
        )
      )
      const sortBox = await page
        .getByRole('button', { name: 'Sort', exact: true })
        .boundingBox()
      const filterBox = await page
        .getByRole('button', { name: 'Filter', exact: true })
        .boundingBox()
      for (const box of [...boxes, sortBox, filterBox])
        assert(
          Math.abs(box.y + box.height / 2 - (sortBox.y + sortBox.height / 2)) <
            1
        )
      assert(boxes[1].x + boxes[1].width < sortBox.x)
      const titles = () =>
        workspace
          .locator('article')
          .evaluateAll((nodes) =>
            nodes.map((node) => node.getAttribute('aria-label'))
          )
      assert.deepEqual(await titles(), [
        'Active expensive',
        'Active cheap',
        'Active furniture',
      ])
      await page.getByRole('button', { name: 'Sort', exact: true }).click()
      await page
        .getByRole('button', { name: 'Price: Low to High', exact: true })
        .click()
      await page.keyboard.press('Escape')
      await page
        .locator('[data-market-focus-backdrop]')
        .waitFor({ state: 'detached' })
      assert.deepEqual(await titles(), [
        'Active cheap',
        'Active furniture',
        'Active expensive',
      ])
      await workspace.getByRole('tab', { name: 'Sold', exact: true }).click()
      await page.waitForTimeout(400)
      assert.deepEqual(await titles(), ['Sold cheap', 'Sold expensive'])
      await workspace.getByRole('tab', { name: 'Active', exact: true }).click()
      await page.waitForTimeout(400)
      await page.getByRole('button', { name: 'Filter', exact: true }).click()
      await page
        .getByRole('combobox', { name: 'Category', exact: true })
        .click()
      await page
        .getByRole('option', { name: 'Home & Dorm', exact: true })
        .click()
      await page.getByRole('button', { name: 'Confirm', exact: true }).click()
      await page
        .locator('[data-market-focus-backdrop]')
        .waitFor({ state: 'detached' })
      assert.deepEqual(await titles(), ['Active furniture'])
      await workspace.getByRole('tab', { name: 'Sold', exact: true }).click()
      await page.waitForTimeout(400)
      assert.deepEqual(
        await titles(),
        [],
        'Filters never merge Active and Sold'
      )
      assert(
        await workspace
          .getByText('No listings match your filters.', { exact: true })
          .isVisible()
      )
      if (width >= 1024) {
        const nav = page.locator('[data-slot="sidebar-body"]').first()
        await nav.hover()
        await page.waitForTimeout(350)
        await nav
          .getByRole('button', { name: 'Favorites', exact: true })
          .click()
        await page.mouse.move(width - 30, 30)
        await page.waitForTimeout(450)
      } else {
        const menu = page.locator('[data-smooth-dropdown]')
        await menu
          .getByRole('button', { name: 'Open Home navigation', exact: true })
          .click()
        await menu
          .getByRole('button', { name: 'Favorites', exact: true })
          .click()
      }
      const favorite = page.getByRole('region', {
        name: 'Favorites',
        exact: true,
      })
      await favorite.locator('article').first().waitFor()
      const favoriteStyles = await inspect('favorites')
      if (width >= 1024) assert.deepEqual(favoriteStyles, market)
      else {
        assert.deepEqual(favoriteStyles.surface, market.surface)
        assert.deepEqual(favoriteStyles.panel, market.panel)
        const favoriteBoxes = await Promise.all(
          ['Sort', 'Filter'].map((name) =>
            favorite.getByRole('button', { name, exact: true }).boundingBox()
          )
        )
        assert.equal(favoriteBoxes[0].width, favoriteBoxes[1].width)
        assert.equal(favoriteBoxes[0].y, favoriteBoxes[1].y)
      }
      const heading = await page
        .getByRole('heading', { name: 'Favorites', exact: true })
        .boundingBox()
      const button = await page
        .getByRole('button', { name: 'Sort', exact: true })
        .boundingBox()
      assert(heading.y + heading.height <= button.y)
      assert.equal(
        await favorite.locator('article').count(),
        2,
        'Sold favorite excluded; no unrelated own listings added'
      )
      await page.getByRole('button', { name: 'Sort', exact: true }).click()
      await page
        .getByRole('button', { name: 'Price: Low to High', exact: true })
        .click()
      assert(favoriteQueries.some((query) => query.includes('sort=price-asc')))
      await page.keyboard.press('Escape')
      await page
        .locator('[data-market-focus-backdrop]')
        .waitFor({ state: 'detached' })
      assert.deepEqual(writes, [])
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: rendered Market/Favorites/My Listings controls and focus surface match, one-row geometry, separate Active/Sold filtering and sorting, Favorites subset unchanged, no overflow/errors/writes`
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
