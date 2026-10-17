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
    for (const width of (process.env.REPLAY_WIDTHS || '390,430,820,1280,1536')
      .split(',')
      .map(Number)) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = [],
        writes = [],
        reconciliations = []
      page.on('pageerror', (error) => errors.push(error.message))
      page.on('request', (request) => {
        if (new URL(request.url()).pathname === '/api/stripe/reconcile')
          reconciliations.push({
            method: request.method(),
            kind: request.postDataJSON()?.kind,
          })
        else if (request.url().includes('/api/') && request.method() !== 'GET')
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
      // Settings already reconciles financial setup when entered. Keep this
      // existing call isolated; this chart/navigation test never reaches Stripe.
      await page.route('**/api/stripe/reconcile', (route) =>
        route.fulfill({ json: { ok: true } })
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
      let releasePeriod = null,
        holdPeriod = false,
        requests = 0,
        failPeriod = false,
        zero = false
      await page.route('**/api/profile/activity?*', async (route) => {
        requests++
        const period = new URL(route.request().url()).searchParams.get('period')
        if (failPeriod) {
          failPeriod = false
          return route.fulfill({
            status: 503,
            json: { error: 'Controlled activity failure' },
          })
        }
        if (holdPeriod)
          await new Promise((resolve) => {
            releasePeriod = resolve
          })
        await route.fulfill({
          json: {
            period,
            points: Array.from(
              { length: period === '1D' ? 24 : parseInt(period) },
              (_, i) => ({
                timestamp: new Date(Date.UTC(2026, 9, i + 1)).toISOString(),
                label: String(i),
                views: zero ? 0 : i + 1,
                listings: zero ? 0 : i % 2,
                sold: zero ? 0 : i % 3,
                overall: zero ? 0 : i + 1 + (i % 2) + (i % 3),
              })
            ),
          },
        })
      })
      await page.goto(
        (process.env.TEST_BASE_URL || 'http://localhost:3000') + '/home',
        {
          waitUntil: 'domcontentloaded',
          timeout: 120000,
        }
      )
      await page.getByText('member@uwo.ca', { exact: true }).waitFor()
      assert.equal(
        await page.locator('[data-chart]').count(),
        0,
        'Profile has information only'
      )
      await page.locator('[data-shop-surface=profile]').waitFor()
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
          .getByRole('button', { name: 'Open Home navigation', exact: true })
          .click()
        if (
          name === 'Analysis' &&
          !(await menu.getByRole('button', { name, exact: true }).count())
        )
          await menu
            .getByRole('button', { name: 'Profile', exact: true })
            .click()
        await menu.getByRole('button', { name, exact: true }).click()
      }
      const select = async (name) => {
        if (desktop && name === 'Analysis') {
          if (
            (await nav
              .getByRole('link', { name: 'Profile', exact: true })
              .getAttribute('aria-expanded')) !== 'true'
          )
            await nav
              .getByRole('link', { name: 'Profile', exact: true })
              .click()
          await nav.hover()
          await nav.getByRole('button', { name, exact: true }).click()
        } else if (desktop)
          await nav.getByRole('link', { name, exact: true }).click()
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
        await select('Analysis')
        await page.waitForFunction(
          (count) => window.chartStarts.length === count + 2,
          before
        )
        assert.equal(
          await page.locator('[data-shop-surface=profile]').count(),
          0
        )
        assert.equal(
          await page
            .locator('[data-shop-surface=analysis] [data-chart]')
            .count(),
          0,
          'Inactive Shop has no fabricated metrics'
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
      await select('Settings')
      await replay('return')
      assert.notEqual(
        await activity.getAttribute('data-chart-replay'),
        sameDestinationToken
      )
      const starts = await page.evaluate(() => window.chartStarts.length)
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
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts + 1,
        'metric replays only Activity once'
      )
      const controlsNode = await activity
        .getByRole('button', { name: 'Views', exact: true })
        .elementHandle()
      const panelNode = await activity.elementHandle()
      holdPeriod = true
      await activity.getByRole('button', { name: '1D', exact: true }).click()
      await page.waitForTimeout(250)
      assert(releasePeriod)
      assert.equal(
        await activity
          .locator('[data-trend-period]')
          .getAttribute('data-trend-period'),
        '7D'
      )
      assert.equal(
        await activity.getByRole('status').count(),
        0,
        'existing chart stays visible without skeleton'
      )
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts + 1,
        'no premature period animation'
      )
      holdPeriod = false
      releasePeriod()
      releasePeriod = null
      await page.waitForTimeout(1800)
      assert.equal(
        await activity
          .locator('[data-trend-period]')
          .getAttribute('data-trend-period'),
        '1D'
      )
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts + 2
      )
      await activity.getByRole('button', { name: '30D', exact: true }).click()
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts + 3
      )
      assert.equal(
        await activity
          .locator('[data-trend-points]')
          .getAttribute('data-trend-points'),
        '30'
      )
      const requestsBefore = requests
      await activity.getByRole('button', { name: '30D', exact: true }).click()
      await page.waitForTimeout(200)
      assert.equal(requests, requestsBefore, 'same period does not refetch')
      failPeriod = true
      await activity.getByRole('button', { name: '7D', exact: true }).click()
      await activity.getByRole('alert').waitFor()
      assert.equal(
        await activity
          .locator('[data-trend-period]')
          .getAttribute('data-trend-period'),
        '30D'
      )
      assert.equal(await activity.getByRole('status').count(), 0)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts + 3
      )
      zero = true
      await activity.getByRole('button', { name: 'Retry', exact: true }).click()
      await page.waitForTimeout(1800)
      assert.equal(
        await activity
          .locator('[data-trend-period]')
          .getAttribute('data-trend-period'),
        '7D'
      )
      assert.equal(
        await activity.locator('.recharts-area-curve').count(),
        1,
        'zero series stays rendered'
      )
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        starts + 4
      )
      zero = false
      assert(await controlsNode.evaluate((node) => node.isConnected))
      assert(await panelNode.evaluate((node) => node.isConnected))
      assert.equal(
        await page.evaluate(
          () =>
            window.chartStarts.filter((x) => x.chart === 'Marketplace Trends')
              .length
        ),
        Math.floor(starts / 2),
        'Activity changes never replay Trends'
      )
      const localStarts = starts + 4
      const localToken = await activity.getAttribute('data-chart-replay')
      await activity.getByRole('button', { name: '1D', exact: true }).focus()
      await activity.hover()
      await page.setViewportSize({ width: width + 20, height: 860 })
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        localStarts,
        'Sidebar, resize, focus and hover do not replay'
      )
      assert.equal(await activity.getAttribute('data-chart-replay'), localToken)
      // Cross the real project breakpoint; consumed clicks must stay consumed.
      await page.setViewportSize({ width: desktop ? 430 : 1280, height: 900 })
      await page.waitForTimeout(500)
      await page.setViewportSize({ width, height: 900 })
      await activity.waitFor()
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        localStarts,
        'Responsive remounts do not replay'
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await select('Analysis')
      await page.waitForTimeout(300)
      assert.equal(await activity.getAttribute('data-chart-animation'), 'idle')
      assert.equal(await market.getAttribute('data-chart-animation'), 'idle')
      assert.equal(await market.locator('.recharts-bar-rectangle').count(), 8)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        localStarts
      )
      const consumedReducedKey = await activity.getAttribute(
        'data-chart-replay'
      )
      await select('Analysis')
      // Await the actual consumed click: Activity refetches on replay. Switching
      // media before that response arrives tests a pending request, not whether
      // changing motion preference replays an already-consumed navigation.
      await page.waitForFunction(
        (key) =>
          document
            .querySelector('[aria-label="Your Activity"]')
            .getAttribute('data-chart-replay') !== key,
        consumedReducedKey
      )
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        localStarts,
        'Changing motion preference does not replay a consumed click: ' +
          JSON.stringify(await page.evaluate(() => window.chartStarts))
      )
      await select('Analysis')
      await page.waitForFunction(
        (count) => window.chartStarts.length === count + 2,
        localStarts
      )
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await page.waitForTimeout(100)
      assert.equal(await activity.getAttribute('data-chart-animation'), 'idle')
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await page.waitForTimeout(1800)
      assert.equal(
        await page.evaluate(() => window.chartStarts.length),
        localStarts + 2,
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
      assert(
        reconciliations.every(
          (r) =>
            r.method === 'POST' &&
            ['payment_method', 'payout_account'].includes(r.kind)
        )
      )
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
