/* global window, document, MutationObserver */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  const output = path.join(process.env.TEMP, 'profile-chart-replay')
  fs.mkdirSync(output, { recursive: true })
  try {
    for (const width of (process.env.REPLAY_WIDTHS || '390,430,1280,1536')
      .split(',')
      .map(Number)) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = [],
        writes = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (request.url().includes('/api/') && request.method() !== 'GET')
          writes.push(request.url())
      })
      await page.route('**/api/**', (route) =>
        route.fulfill({
          status: 501,
          json: { error: 'Unexpected verification request' },
        })
      )
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      await page.route('**/api/auth/session', (route) =>
        route.fulfill({
          json: { seller: { id: 'fixture', displayName: 'CampusMember' } },
        })
      )
      await page.route('**/api/profile/account', (route) =>
        route.fulfill({
          json: {
            username: 'CampusMember',
            email: 'member@uwo.ca',
            emailVerified: true,
            createdAt: '2026-10-01T12:00:00Z',
            nextUsernameChangeAt: null,
          },
        })
      )
      await page.route('**/api/profile/categories', (route) =>
        route.fulfill({
          json: [
            'Electronics',
            'Home & Dorm',
            'Textbooks & School',
            'Clothing & Accessories',
            'Sports & Outdoors',
            'Bikes & Mobility',
            'Games & Hobbies',
            'Other',
          ].map((category, index) => ({ category, count: 80 - index * 9 })),
        })
      )
      await page.route('**/api/listings*', (route) =>
        route.fulfill({ json: [] })
      )
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      await page.getByText('member@uwo.ca', { exact: true }).waitFor()
      await page.evaluate(() => {
        window.chartStarts = []
        const phases = new WeakMap()
        new MutationObserver((records) => {
          for (const el of new Set(records.map((record) => record.target))) {
            const phase = el.getAttribute('data-chart-animation')
            if (phase === 'running' && phases.get(el) !== 'running')
              window.chartStarts.push({
                chart: el.getAttribute('aria-label'),
                token: el.getAttribute('data-chart-replay'),
              })
            phases.set(el, phase)
          }
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-chart-animation'],
        })
      })
      const desktop = width >= 1024
      const nav = page.locator('[data-slot="sidebar-body"]').first()
      const mobileSelect = async (name) => {
        const menu = page.locator('[data-smooth-dropdown]')
        await menu
          .getByRole('button', { name: 'Show more', exact: true })
          .click()
        await menu.getByRole('button', { name, exact: true }).click()
      }
      const select = async (name) => {
        if (desktop) await nav.getByRole('link', { name, exact: true }).click()
        else await mobileSelect(name)
      }
      const activity = page.getByRole('region', {
        name: 'Your Activity',
        exact: true,
      })
      const market = page.getByRole('region', {
        name: 'Marketplace Trends',
        exact: true,
      })
      const replay = async (label) => {
        const before = await page.evaluate(() => window.chartStarts.length)
        await select(desktop ? 'Profile' : 'Analytics')
        await page.waitForFunction(
          (count) => window.chartStarts.length === count + 2,
          before
        )
        const token = await activity.getAttribute('data-chart-replay')
        assert.equal(await market.getAttribute('data-chart-replay'), token)
        // Native SVG entrance is actually running, rather than only a changed key.
        assert.equal(
          await activity.getAttribute('data-chart-animation'),
          'running'
        )
        assert(
          (await activity
            .locator('clipPath[id^="animationClipPath-"]')
            .count()) > 0
        )
        await page.screenshot({
          path: path.join(output, `${width}-${label}-entrance.png`),
        })
        await activity.locator('.recharts-area-curve').waitFor()
        await page.waitForFunction(() =>
          [...document.querySelectorAll('[data-chart-animation]')].every(
            (el) => el.dataset.chartAnimation === 'idle'
          )
        )
        await page.waitForTimeout(200)
        assert.equal(
          await page.evaluate(() => window.chartStarts.length),
          before + 2,
          'Exactly one native start per chart per navigation action'
        )
        assert.equal(await market.locator('.recharts-bar-rectangle').count(), 8)
        return token
      }
      if (desktop) await select('Listings')
      await replay('entry')
      const curve = await activity
        .locator('.recharts-area-curve')
        .getAttribute('d')
      const metricNode = await activity
        .getByRole('button', { name: 'Overall', exact: true })
        .elementHandle()
      const sameDestinationToken = await replay('repeat')
      assert(
        await metricNode.evaluate((node) => node.isConnected),
        'Replay does not remount Analytics controls'
      )
      assert.equal(
        await activity.locator('.recharts-area-curve').getAttribute('d'),
        curve,
        'Settled chart data and geometry unchanged'
      )
      await select(desktop ? 'Settings' : 'Payment')
      await replay('return')
      assert.notEqual(
        await activity.getAttribute('data-chart-replay'),
        sameDestinationToken
      )
      const starts = await page.evaluate(() => window.chartStarts.length)
      const token = await activity.getAttribute('data-chart-replay')
      if (desktop) {
        await nav.hover()
        await nav
          .getByRole('button', { name: 'Keep expanded', exact: true })
          .click()
        await page.mouse.move(width - 30, 30)
        await page.waitForTimeout(450)
        await nav
          .getByRole('button', { name: 'Keep expanded', exact: true })
          .click()
        await page.mouse.move(width - 30, 30)
        await page.waitForTimeout(450)
      }
      await activity.getByRole('button', { name: 'Views', exact: true }).click()
      await activity.getByRole('button', { name: '1D', exact: true }).click()
      await activity.getByRole('button', { name: '1D', exact: true }).focus()
      await activity.hover()
      await page.setViewportSize({ width: width + 20, height: 860 })
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts,
        'Sidebar, resize, focus, hover and ordinary data/control updates do not replay'
      )
      assert.equal(await activity.getAttribute('data-chart-replay'), token)
      // Cross the real project breakpoint; consumed clicks must stay consumed.
      await page.setViewportSize({ width: desktop ? 430 : 1280, height: 900 })
      await page.waitForTimeout(500)
      await page.setViewportSize({ width, height: 900 })
      await activity.waitFor()
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts,
        'Responsive remounts do not replay'
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await select(desktop ? 'Profile' : 'Analytics')
      await page.waitForTimeout(300)
      assert.equal(await activity.getAttribute('data-chart-animation'), 'idle')
      assert.equal(await market.getAttribute('data-chart-animation'), 'idle')
      assert.equal(await market.locator('.recharts-bar-rectangle').count(), 8)
      assert.equal(await page.evaluate(() => window.chartStarts.length), starts)
      await select(desktop ? 'Profile' : 'Analytics')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts,
        'Changing motion preference does not replay a consumed click'
      )
      await select(desktop ? 'Profile' : 'Analytics')
      await page.waitForFunction(
        (count) => window.chartStarts.length === count + 2,
        starts
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(100)
      assert.equal(await activity.getAttribute('data-chart-animation'), 'idle')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts + 2,
        'Reduced motion cancels an active entrance without replay on re-enable'
      )
      await page.mouse.move(width - 30, 30)
      await page.waitForTimeout(450)
      await page.screenshot({
        path: path.join(output, `${width}-settled.png`),
        fullPage: true,
      })
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      assert.deepEqual(writes, [])
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: entry, active repeat, return, chart-only remount, sidebar/resize/breakpoint/data exclusions, reduced motion, no writes/errors/overflow`
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
