/* global Navigator, getComputedStyle, requestAnimationFrame */
/* eslint-disable no-inner-declarations -- Per-viewport helpers own isolated fixtures. */
const assert = require('node:assert/strict')
const item = {
  id: 'reveal-fixture',
  title: 'Camera fixture',
  price: 1000,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'On campus',
  description: 'Fixture only',
  photoUrls: ['/demo/reading-chair.jpg'],
  seller: { id: 'other', displayName: 'Seller' },
  status: 'available',
  publishedAt: '2026-10-05',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
}
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
          isMobile: width < 1024,
          hasTouch: width < 1024,
          serviceWorkers: 'block',
        }),
        gates = { account: [], categories: [], listings: [], favorites: [] },
        errors = []
      let populated = false
      page.on('pageerror', (e) => errors.push(e.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/**', async (r) => {
        assert.equal(r.request().method(), 'GET')
        const p = new URL(r.request().url()).pathname
        if (p === '/api/auth/session')
          return r.fulfill({
            json: { seller: { id: 'owner', displayName: 'Fixture' } },
          })
        if (p === '/api/profile/account') {
          await new Promise((resolve) => gates.account.push(resolve))
          return r.fulfill({
            json: {
              username: 'Fixture',
              email: 'fixture@uwo.ca',
              emailVerified: true,
              createdAt: '2026-10-01',
              nextUsernameChangeAt: null,
            },
          })
        }
        if (p === '/api/profile/categories') {
          await new Promise((resolve) => gates.categories.push(resolve))
          return r.fulfill({ json: [{ category: 'Electronics', count: 0 }] })
        }
        if (p === '/api/listings' || p === '/api/favorites') {
          const key = p.split('/').pop()
          await new Promise((resolve) => gates[key].push(resolve))
          return r.fulfill({ json: populated ? [item] : [] })
        }
        return r.fulfill({ json: [] })
      })
      async function release(key) {
        for (let n = 0; n < 200 && !gates[key].length; n++)
          await page.waitForTimeout(10)
        assert(gates[key].length, 'request reached delayed fixture')
        gates[key].splice(0).forEach((resolve) => resolve())
      }
      async function select(group, child) {
        if (width < 1024) {
          const menu = page.locator('[data-smooth-dropdown]')
          await menu
            .getByRole('button', { name: 'Show more', exact: true })
            .click()
          if (
            child &&
            !(await menu
              .getByRole('button', { name: child, exact: true })
              .count())
          )
            await menu.getByRole('button', { name: group, exact: true }).click()
          await menu
            .getByRole('button', { name: child || group, exact: true })
            .click()
        } else {
          const rail = page.locator('[data-slot="sidebar-body"]')
          await rail.hover()
          await rail.getByRole('link', { name: group, exact: true }).click()
          await page.mouse.move(width - 20, 500)
        }
      }
      async function reveal(locator) {
        await locator.waitFor({ state: 'attached' })
        const frames = await locator.evaluate(async (n) => {
          let a
          for (let i = 0; i < 60; i++) {
            a = n
              .getAnimations()
              .find((a) => a.animationName?.includes('content-reveal'))
            if (a) break
            await new Promise((r) => requestAnimationFrame(r))
          }
          if (!a) throw Error('missing content reveal')
          a.pause()
          const frames = [0, 80, 160].map((t) => {
            a.currentTime = t
            const c = getComputedStyle(n)
            return {
              opacity: Number(c.opacity),
              transform: c.transform,
              duration: a.effect.getTiming().duration,
            }
          })
          a.currentTime = 160
          a.play()
          return frames
        })
        assert.equal(frames[0].opacity, 0)
        assert(frames[1].opacity > 0 && frames[1].opacity < 1)
        assert.equal(frames[2].opacity, 1)
        assert(
          frames.every((f) => f.transform === 'none' && f.duration === 160)
        )
        console.log(width, 'reveal', frames)
        await page.waitForTimeout(200)
      }
      await page.goto(
        (process.env.HOME_TEST_URL || 'http://localhost:3100') + '/home',
        {
          waitUntil: 'domcontentloaded',
        }
      )
      await page
        .locator(
          '[data-profile-account][aria-busy="true"] [data-slot="skeleton"]'
        )
        .first()
        .waitFor()
      assert.equal(
        await page
          .getByText(
            /^Loading(?:\u2026|\.\.\.| profile| account| settings| analytics)/
          )
          .count(),
        0
      )
      await page.screenshot({
        path:
          process.env.TEMP + '/home-final-' + width + '-profile-loading.png',
      })
      await release('account')
      await reveal(page.getByRole('region', { name: 'Overview', exact: true }))
      if (width < 1024) await select('Profile', 'Analytics')
      const trends = page.getByRole('region', {
        name: 'Marketplace Trends',
        exact: true,
      })
      await trends.locator('[data-slot="skeleton"]').first().waitFor()
      assert.equal(await trends.getByText(/Loading category/).count(), 0)
      await release('categories')
      await reveal(trends.getByText('No active listings yet.', { exact: true }))
      await select('Settings')
      await page
        .locator(
          '[data-profile-account][aria-busy="true"] [data-slot="skeleton"]'
        )
        .first()
        .waitFor()
      await release('account')
      await reveal(
        page.getByRole('region', { name: 'Account & Security', exact: true })
      )
      await page.getByRole('button', { name: 'Log out', exact: true }).click()
      const dialog = page.getByRole('dialog', { name: 'Log out?', exact: true })
      await dialog.waitFor()
      await page.waitForTimeout(350)
      const cancel = dialog.getByRole('button', {
        name: 'Cancel',
        exact: true,
      })
      const colors = await dialog.getByRole('button').evaluateAll((ns) =>
        ns.map((n) => {
          const r = n.getBoundingClientRect(),
            s = n.querySelector('span')
          return {
            label: n.textContent.trim(),
            background: getComputedStyle(s).backgroundColor,
            width: r.width,
            height: r.height,
          }
        })
      )
      assert.equal(colors[0].background, 'rgb(22, 101, 52)')
      assert.equal(colors[1].background, 'rgb(119, 45, 64)')
      assert.equal(colors[0].width, colors[1].width)
      assert.equal(colors[0].height, colors[1].height)
      console.log(width, 'colors', colors)
      await page.screenshot({
        path: process.env.TEMP + '/home-final-' + width + '-logout.png',
      })
      await cancel.click()
      await dialog.waitFor({ state: 'detached' })
      for (populated of [false, true])
        for (const name of ['my-listings', 'favorites']) {
          await page.goto(
            (process.env.HOME_TEST_URL || 'http://localhost:3100') +
              '/home?section=' +
              name,
            { waitUntil: 'domcontentloaded' }
          )
          const region = page.getByRole('region', {
            name: name === 'favorites' ? 'Favorites' : 'My Listings',
            exact: true,
          })
          await region.locator('[data-content-loading-spinner]').waitFor()
          await release(name === 'favorites' ? 'favorites' : 'listings')
          await reveal(
            region
              .locator(
                populated ? 'div[class*="grid"]' : '[data-workspace-empty]'
              )
              .first()
          )
          if (name === 'my-listings') {
            await region.getByRole('tab', { name: 'Sold', exact: true }).click()
            await page.waitForTimeout(400)
            assert.equal(
              await region
                .locator('[data-workspace-empty]')
                .evaluate(
                  (n) =>
                    n
                      .getAnimations()
                      .filter((a) =>
                        a.animationName?.includes('content-reveal')
                      ).length
                ),
              0,
              'loaded tab must not replay network reveal'
            )
          }
        }
      assert.deepEqual(errors, [])
      await page.close()
      console.log('PASS', width)
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
