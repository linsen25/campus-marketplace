/* global document, getComputedStyle, innerWidth */
// Current Home UI with intercepted APIs only: no hosted identity or data writes.
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
    for (const reduced of process.env.NAV_REDUCED === 'true' ? [true] : [false, true]) {
      for (const width of (process.env.NAV_WIDTHS || '390,430,820,1280,1536').split(',').map(Number)) {
        const page = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
          serviceWorkers: 'block',
        })
        const calls = [],
          errors = []
        page.on('pageerror', (e) => errors.push(e.message))
        await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
          r.abort()
        )
        await page.route('**/api/**', (r) => {
          const url = new URL(r.request().url()),
            path = url.pathname
          calls.push({ path, method: r.request().method() })
          const send = (json) => r.fulfill({ json })
          if (path === '/api/auth/session')
            return send({ seller: { id: 'owner', displayName: 'Fixture' } })
          if (path === '/api/profile/account')
            return send({
              username: 'Fixture',
              email: 'fixture@uwo.ca',
              emailVerified: true,
              createdAt: '2026-10-01',
            })
          if (
            path === '/api/listings' ||
            path === '/api/favorites' ||
            path === '/api/profile/categories'
          )
            return send([])
          return r.fulfill({
            status: 501,
            json: { error: 'No hosted requests in this fixture' },
          })
        })
        const destinations = [
          ['my-listings', 'My Resale'],
          ['create-listing', 'Create Resale'],
          ['favorites', 'Favorites'],
          ['my-shop', 'My Shop'],
          ['create-shop-listing', 'Create Shop Listing'],
        ]
        for (const [id, label] of destinations) {
          calls.length = 0
          await page.goto(`http://localhost:3000/home?section=${id}`, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
          })
          await page
            .getByRole('heading', { name: label, exact: true })
            .first()
            .waitFor()
          const mobile = width < 1024
          const nav = mobile
            ? page.locator('[data-smooth-menu]')
            : page.locator('[data-slot="sidebar-body"]')
          const trigger = page.getByRole('button', {
            name: 'Open Home navigation',
            exact: true,
          })
          if (mobile) await trigger.click()
          else await nav.hover()
          const leaves = nav.getByRole('button', {
            name: 'My Shop',
            exact: true,
          })
          await leaves.waitFor({ state: 'visible' })
          assert.equal(
            await nav
              .getByRole('button', { name: 'My Resale', exact: true })
              .count(),
            1
          )
          assert.equal(
            await nav
              .getByRole('button', { name: 'Favorites', exact: true })
              .count(),
            1
          )
          assert.equal(
            await nav
              .getByRole('button', {
                name: /^(Resale|Shop|Create Resale|Create Shop Listing)$/,
              })
              .count(),
            0
          )
          assert.equal(await nav.locator('[data-shop-pro-badge]').count(), 1)
          const navLabel =
            id === 'create-listing'
              ? 'My Resale'
              : id === 'create-shop-listing'
              ? 'My Shop'
              : label
          assert.equal(
            await nav
              .getByRole('button', { name: navLabel, exact: true })
              .getAttribute('aria-current'),
            'page'
          )
          const badge = nav.locator('[data-shop-pro-badge]')
          assert.deepEqual(
            await badge.evaluate((n) => ({
              bg: getComputedStyle(n).backgroundColor,
              color: getComputedStyle(n).color,
              chip: getComputedStyle(n.querySelector('span')).backgroundColor,
              svg: n.querySelector('svg').getBoundingClientRect().width,
            })),
            {
              bg: 'rgb(74, 222, 128)',
              color: 'rgb(0, 0, 0)',
              chip: 'rgb(21, 128, 61)',
              svg: 14,
            }
          )
          for (const button of await leaves.all()) {
            const box = await button.boundingBox()
            assert(
              box.x >= 0 && box.x + box.width <= width,
              'Shop labels within viewport'
            )
          }
          if (id.includes('shop')) {
            const surface = page.locator('[data-shop-listing-workspace]')
            await surface
              .getByText("Your Shop isn't active yet.", { exact: true })
              .waitFor()
            assert.equal(
              await surface
                .locator('form,article,button:not(:disabled)')
                .count(),
              0
            )
            if (id === 'my-shop')
              assert(
                await surface
                  .getByRole('button', {
                    name: 'Create Shop Listing',
                    exact: true,
                  })
                  .isDisabled()
              )
            assert.equal(
              calls.filter((c) => c.path === '/api/listings').length,
              0,
              'Shop never loads ordinary owner inventory'
            )
          }
          if (mobile) {
            const leaf = nav.getByRole('button', {
              name: navLabel,
              exact: true,
            })
            await leaf.focus()
            await page.keyboard.press('ArrowDown')
            assert(
              await nav.locator('button:focus').count(),
              'Arrow navigation remains within existing menu'
            )
            await page.keyboard.press('Escape')
            assert.equal(await trigger.getAttribute('aria-expanded'), 'false')
            assert(await trigger.evaluate((n) => n === document.activeElement))
          }
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            ),
            'No page overflow'
          )
        }
        // Parent selection retains the established default My Resale destination.
        if (width < 1024) {
          const trigger = page.getByRole('button', {
            name: 'Open Home navigation',
            exact: true,
          })
          await trigger.click()
          const parent = page
            .locator('[data-smooth-menu]')
            .getByRole('button', { name: 'Listings', exact: true })
          await parent.click() // collapse
          await parent.click() // expand and select default
          await page
            .getByRole('heading', { name: 'My Resale', exact: true })
            .waitFor()
        } else {
          const nav = page.locator('[data-slot="sidebar-body"]')
          await nav.hover()
          await nav.getByRole('link', { name: 'Listings', exact: true }).click()
          await page
            .getByRole('heading', { name: 'My Resale', exact: true })
            .waitFor()
        }
        if (width < 1024) await page.keyboard.press('Escape')
        else await page.mouse.move(width - 20, 450)
        await page
          .getByRole('region', { name: 'My Resale', exact: true })
          .getByRole('button', { name: 'Create Resale', exact: true })
          .click()
        await page
          .getByRole('form', { name: 'Create Resale', exact: true })
          .waitFor()
        assert.equal(
          calls.filter((c) => c.method !== 'GET').length,
          0,
          'No writes'
        )
        assert.deepEqual(errors, [])
        console.log(
          `PASS ${width} reduced=${reduced}: all five IDs restore, three peer destinations/current state, one Favorites, inactive Shop, badge geometry, keyboard, default, no overflow/writes`
        )
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
