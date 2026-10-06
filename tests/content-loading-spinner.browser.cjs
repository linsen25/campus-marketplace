/* global document, window, getComputedStyle, Navigator */
const assert = require('node:assert/strict')
const fs = require('node:fs'),
  path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'content-loading-spinner')
fs.mkdirSync(output, { recursive: true })
const item = {
  id: 'spinner-fixture',
  title: 'Camera fixture',
  price: 1000,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'On campus',
  description: 'Fixture only',
  photoUrls: ['/demo/reading-chair.jpg'],
  seller: { id: 'owner', displayName: 'Fixture' },
  status: 'available',
  publishedAt: '2026-10-05',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
}
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 430, 1280, 1536])
      for (const section of ['favorites', 'my-listings', 'sold'])
        for (const populated of [false, true]) {
          const page = await browser.newPage({
              viewport: { width, height: 900 },
              serviceWorkers: 'block',
            }),
            errors = [],
            gates = []
          await page.addInitScript(() => {
            delete Navigator.prototype.serviceWorker
          })
          page.on('pageerror', (e) => errors.push(e.message))
          await page.route(
            /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            (r) => r.abort()
          )
          await page.route('**/api/**', async (r) => {
            const p = new URL(r.request().url()).pathname
            assert.equal(r.request().method(), 'GET', 'no verification writes')
            if (p === '/api/auth/session')
              return r.fulfill({ json: { seller: item.seller } })
            if (p === '/api/profile/account')
              return r.fulfill({
                json: {
                  username: 'Fixture',
                  email: 'fixture@uwo.ca',
                  emailVerified: true,
                  createdAt: '2026-10-01',
                  nextUsernameChangeAt: null,
                },
              })
            if (
              p ===
              '/api/' + (section === 'favorites' ? 'favorites' : 'listings')
            ) {
              await new Promise((resolve) => gates.push(resolve))
              return r.fulfill({
                json: populated
                  ? [
                      {
                        ...item,
                        status: section === 'sold' ? 'sold' : 'available',
                        seller:
                          section === 'favorites'
                            ? { id: 'other', displayName: 'Seller' }
                            : item.seller,
                      },
                    ]
                  : [],
              })
            }
            return r.fulfill({ json: [] })
          })
          await page.goto(
            'http://localhost:3100/home?section=' +
              (section === 'sold' ? 'my-listings' : section),
            {
              waitUntil: 'domcontentloaded',
            }
          )
          const workspace = page.getByRole('region', {
            name: section === 'favorites' ? 'Favorites' : 'My Listings',
            exact: true,
          })
          const spinner = workspace.locator('[data-content-loading-spinner]')
          await spinner.waitFor()
          if (section === 'sold') {
            await workspace
              .getByRole('tab', { name: 'Sold', exact: true })
              .click()
            await page.waitForTimeout(400)
          }
          const controls = workspace.locator(
            '[data-market-controls], [role="tablist"]'
          )
          const rects = await controls.evaluateAll((nodes) =>
            nodes.map((el) => {
              const r = el.getBoundingClientRect()
              return {
                x: r.x,
                y: r.y,
                width: r.width,
                height: r.height,
                opacity: getComputedStyle(el).opacity,
              }
            })
          )
          const position = await spinner.evaluate((el) => {
            const r = el.getBoundingClientRect(),
              box = el.parentElement.getBoundingClientRect(),
              ring = getComputedStyle(el.firstElementChild),
              center = { x: r.x + r.width / 2, y: r.y + r.height / 2 }
            return {
              width: r.width,
              height: r.height,
              border: ring.borderTopWidth,
              color: ring.borderTopColor,
              centerX: Math.abs(r.x + r.width / 2 - box.x - box.width / 2),
              centerY: Math.abs(r.y + r.height / 2 - box.y - box.height / 2),
              center,
              text: el.textContent,
            }
          })
          assert.equal(position.width, 40)
          assert.equal(position.height, 40)
          assert.equal(position.border, '3px')
          assert.equal(position.color, 'rgb(144, 0, 255)')
          assert(position.centerX < 1 && position.centerY < 1)
          assert.equal(position.text, '')
          assert.equal(
            await workspace
              .getByText(/Loading favorites|Loading your listings/)
              .count(),
            0
          )
          const first = await spinner
            .locator('span')
            .evaluate((el) => getComputedStyle(el).transform)
          await page.waitForTimeout(180)
          assert.notEqual(
            await spinner
              .locator('span')
              .evaluate((el) => getComputedStyle(el).transform),
            first,
            'actual rotation'
          )
          await page.screenshot({
            path: path.join(output, `${width}-${section}-loading.png`),
          })
          await page.emulateMedia({ reducedMotion: 'reduce' })
          await page.waitForTimeout(50)
          const still = await spinner
            .locator('span')
            .evaluate((el) => getComputedStyle(el).transform)
          await page.waitForTimeout(180)
          assert.equal(
            await spinner
              .locator('span')
              .evaluate((el) => getComputedStyle(el).transform),
            still,
            'reduced motion static ring'
          )
          assert.deepEqual(
            await controls.evaluateAll((nodes) =>
              nodes.map((el) => {
                const r = el.getBoundingClientRect()
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  opacity: getComputedStyle(el).opacity,
                }
              })
            ),
            rects
          )
          for (const resolve of gates) resolve()
          await spinner.waitFor({ state: 'detached' })
          if (populated) await workspace.getByRole('article').first().waitFor()
          else
            await workspace
              .getByText(
                section === 'favorites'
                  ? 'No favorites yet.'
                  : section === 'sold'
                  ? 'No sold listings yet.'
                  : 'No active listings yet.',
                { exact: true }
              )
              .waitFor()
          if (!populated) {
            const emptyCenter = await workspace
              .locator('[data-workspace-empty] p')
              .evaluate((el) => {
                const r = el.getBoundingClientRect()
                return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
              })
            assert(Math.abs(emptyCenter.x - position.center.x) < 0.1)
            assert(
              Math.abs(emptyCenter.y - position.center.y) < 0.1,
              'no loading-to-empty jump'
            )
            console.log('ANCHOR', width, section, position.center, emptyCenter)
          }
          assert.deepEqual(
            await controls.evaluateAll((nodes) =>
              nodes.map((el) => {
                const r = el.getBoundingClientRect()
                return {
                  x: r.x,
                  y: r.y,
                  width: r.width,
                  height: r.height,
                  opacity: getComputedStyle(el).opacity,
                }
              })
            ),
            rects,
            'toolbar unchanged after response'
          )
          assert.equal(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            ),
            true
          )
          assert.deepEqual(errors, [])
          console.log(
            'PASS',
            width,
            section,
            populated ? 'cards' : 'empty',
            position
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
