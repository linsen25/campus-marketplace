const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const before = Boolean(process.env.MOBILE_HEADER_BEFORE)
const directory = process.env.TEMP
const prefix = directory + '/home-mobile-header-'
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const mobile = width < 1024
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      await page.route('**/api/**', (route) => {
        assert.equal(route.request().method(), 'GET')
        const path = new URL(route.request().url()).pathname
        if (path === '/api/auth/session')
          return route.fulfill({
            json: { seller: { id: 'owner', displayName: 'Fixture' } },
          })
        if (path === '/api/profile/account')
          return route.fulfill({
            json: {
              username: 'Fixture',
              email: 'fixture@uwo.ca',
              emailVerified: true,
              createdAt: '2026-10-01',
              nextUsernameChangeAt: null,
            },
          })
        return route.fulfill({ json: [] })
      })
      await page.goto(
        (process.env.HOME_TEST_URL || 'http://localhost:3101') + '/home',
        { waitUntil: 'domcontentloaded' }
      )
      await page.waitForTimeout(1600)
      const nav = page.locator(
        mobile ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
      )
      const trigger = () =>
        nav.getByRole('button', {
          name: before ? 'Show more' : 'Open Home navigation',
          exact: true,
        })
      const select = async (group, child) => {
        if (mobile) {
          if ((await trigger().getAttribute('aria-expanded')) === 'false')
            await trigger().click()
        } else await nav.hover()
        const parent = nav.getByRole(mobile ? 'button' : 'link', {
          name: group,
          exact: true,
        })
        if (
          !mobile ||
          !child ||
          (await parent.getAttribute('aria-expanded')) !== 'true'
        )
          await parent.click()
        if (child)
          await nav.getByRole('button', { name: child, exact: true }).click()
        if (!mobile) await page.mouse.move(width - 20, 600)
        await page.waitForTimeout(600)
      }
      const record = {}
      const capture = async (label) => {
        await page.screenshot({
          path:
            prefix +
            width +
            '-' +
            (before ? 'before-' : '') +
            label.toLowerCase().replace(/ /g, '-') +
            '.png',
        })
        const header = page.locator(
          mobile
            ? '[data-home-mobile-header]'
            : '[data-home-main] > [data-home-section-header]'
        )
        if (!before && mobile) {
          assert.equal(
            await header.getByRole('heading', { level: 1 }).innerText(),
            label === 'Messages' ? 'Buying' : label
          )
          assert.equal(
            await page
              .getByRole('heading', {
                name: label === 'Messages' && mobile ? 'Buying' : label,
                exact: true,
              })
              .count(),
            1
          )
          assert(!(await header.innerText()).includes('Campus Marketplace'))
          assert.equal(
            await page
              .getByRole('button', { name: 'Show more', exact: true })
              .count(),
            0
          )
          assert(
            await header
              .getByRole('heading', { level: 1 })
              .evaluate(
                (el) => getComputedStyle(el).textOverflow === 'ellipsis'
              )
          )
          assert(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth
            )
          )
        }
        if (!mobile) {
          assert.equal(
            await header.getByRole('heading', { level: 2 }).innerText(),
            label === 'Overview' ? 'Profile' : label
          )
        }
        record[label] = await page.evaluate((mobile) => {
          const selectors = mobile
            ? ['[data-home-mobile-header]', '[aria-label="Messages"]']
            : [
                '[data-slot="sidebar-body"]',
                '[data-home-main]',
                '[data-home-main] > [data-home-section-header]',
                '[aria-label="Messages"]',
                '[aria-label="Favorites"] [data-market-controls]',
              ]
          return selectors.map((selector) => {
            const el = document.querySelector(selector)
            if (!el) return null
            const r = el.getBoundingClientRect(),
              s = getComputedStyle(el)
            return {
              selector,
              x: r.x,
              y: r.y,
              width: r.width,
              height: r.height,
              display: s.display,
              padding: s.padding,
              gap: s.gap,
              fontSize: s.fontSize,
            }
          })
        }, mobile)
      }
      await capture('Overview')
      for (const [group, child, title] of [
        ['Listings', 'Create Listing', 'Create Listing'],
        ['Listings', 'My Listings', 'My Listings'],
        ['Listings', 'Favorites', 'Favorites'],
        ['Messages', 'Buying', 'Messages'],
        ['Settings', null, 'Settings'],
      ]) {
        await select(group, child)
        await capture(title)
        if (title === 'Favorites' && !before) {
          const workspace = page.getByRole('region', {
            name: 'Favorites',
            exact: true,
          })
          const sort = workspace.getByRole('button', {
              name: 'Sort',
              exact: true,
            }),
            filter = workspace.getByRole('button', {
              name: 'Filter',
              exact: true,
            })
          const a = await sort.boundingBox(),
            b = await filter.boundingBox(),
            w = await workspace.boundingBox()
          if (mobile) {
            assert(a.x > w.x + 100)
            assert(Math.abs(b.x + b.width - w.x - w.width) < 1)
            assert.equal(a.y, b.y)
            assert.equal(b.x - a.x - a.width, 8)
          }
          await sort.click()
          await page.waitForTimeout(450)
          const region = page.getByRole('region', {
            name: 'Sort scrolling content',
          })
          const r = await region.boundingBox()
          assert(r.width > 150)
          assert(r.x >= 0 && r.x + r.width <= width)
          await page.screenshot({ path: prefix + width + '-sort-open.png' })
          await region
            .getByRole('button', { name: 'Price: High to Low', exact: false })
            .click()
          assert.equal(
            await region
              .getByRole('button', { name: 'Price: High to Low', exact: false })
              .getAttribute('aria-pressed'),
            'true'
          )
          await page.keyboard.press('Escape')
          await page
            .locator('[data-market-focus-backdrop]')
            .waitFor({ state: 'detached' })
          assert.equal(
            await page.locator('[data-market-focus-backdrop]').count(),
            0
          )
          await filter.click()
          await page.waitForTimeout(500)
          assert.equal(
            await page.locator('[data-market-focus-backdrop]').count(),
            1
          )
          await page.screenshot({ path: prefix + width + '-filter-open.png' })
          await page
            .getByRole('button', { name: 'Cancel', exact: true })
            .click()
          await page.waitForTimeout(500)
        }
      }
      if (before)
        fs.writeFileSync(
          prefix + width + '-baseline.json',
          JSON.stringify(record)
        )
      else if (fs.existsSync(prefix + width + '-baseline.json')) {
        const baseline = JSON.parse(
          fs.readFileSync(prefix + width + '-baseline.json')
        )
        if (!mobile)
          assert.deepEqual(
            record,
            baseline,
            'desktop geometry and styles must remain identical'
          )
        else {
          const find = (r) =>
            r.Messages.find(
              (item) => item?.selector === '[aria-label="Messages"]'
            )
          assert(find(record).height > find(baseline).height)
          console.log(
            'Messages space gain',
            width,
            find(record).height - find(baseline).height
          )
        }
      }
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        before ? 'baseline' : 'titles, controls, navigation, regression'
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
