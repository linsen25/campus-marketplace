/* global window, document, getComputedStyle, requestAnimationFrame, MutationObserver, Navigator */
/* eslint-disable no-inner-declarations -- Each viewport owns isolated frame and navigation fixtures. */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'local-tab-content-checks')
fs.mkdirSync(output, { recursive: true })
const listing = (id, sold) => ({
  id,
  title: id,
  price: 1000,
  currency: 'CAD',
  category: 'Electronics',
  subcategory: 'Cameras',
  condition: 'good',
  pickupArea: 'On campus',
  description: 'Local fixture.',
  photoUrls: ['/demo/reading-chair.jpg'],
  seller: { id: 'owner', displayName: 'Fixture' },
  status: sold ? 'sold' : 'available',
  publishedAt: '2026-10-05',
  createdAt: '2026-10-05',
  updatedAt: '2026-10-05',
})
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of (process.env.TAB_WIDTHS || '390,430,1280,1536')
      .split(',')
      .map(Number)) {
      const desktop = width >= 1024,
        errors = [],
        writes = []
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      await page.addInitScript(() => {
        delete Navigator.prototype.serviceWorker
      })
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      let rows = [
        ...Array.from({ length: 12 }, (_, i) => listing('Active ' + i, false)),
        ...Array.from({ length: 12 }, (_, i) => listing('Sold ' + i, true)),
      ]
      await page.route('**/api/**', (r) => {
        const p = new URL(r.request().url()).pathname
        if (r.request().method() !== 'GET') {
          writes.push(p)
          return r.fulfill({ status: 501, json: { error: 'Writes blocked' } })
        }
        if (p === '/api/auth/session')
          return r.fulfill({
            json: { seller: { id: 'owner', displayName: 'Fixture' } },
          })
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
        if (p === '/api/profile/categories')
          return r.fulfill({
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
        if (p === '/api/listings') return r.fulfill({ json: rows })
        return r.fulfill({ json: [] })
      })
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'networkidle',
      })
      await page.getByText('fixture@uwo.ca', { exact: true }).waitFor()
      await page.evaluate(() => {
        window.chartStarts = []
        const phases = new WeakMap()
        new MutationObserver((records) => {
          for (const el of new Set(records.map((r) => r.target))) {
            const phase = el.getAttribute('data-chart-animation')
            if (phase === 'running' && phases.get(el) !== 'running')
              window.chartStarts.push(el.dataset.chartReplay)
            phases.set(el, phase)
          }
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-chart-animation'],
        })
      })
      const select = async (group, child) => {
        if (desktop) {
          const rail = page.locator('[data-slot="sidebar-body"]')
          await rail.hover()
          await page.waitForTimeout(320)
          if (child) {
            await rail.getByRole('link', { name: group, exact: true }).click()
            await rail.getByRole('button', { name: child, exact: true }).click()
          } else
            await rail.getByRole('link', { name: group, exact: true }).click()
          await page.mouse.move(width - 20, 500)
        } else {
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
        }
      }
      async function fade(to, click, controls, emptyDestination = false) {
        const controlNodes = await controls.elementHandles()
        const baseline = await controls.evaluateAll((nodes) =>
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
        await page.evaluate(() => {
          window.fadeFrames = []
          window.sampleFade = true
          const sample = () => {
            if (!window.sampleFade) return
            window.fadeFrames.push(
              [...document.querySelectorAll('[data-local-tab-content]')].map(
                (el) => {
                  const r = el.getBoundingClientRect(),
                    s = getComputedStyle(el)
                  return {
                    key: el.dataset.localTabContent,
                    opacity: Number(s.opacity),
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: r.height,
                    transform: s.transform,
                    filter: s.filter,
                    text: el.textContent,
                  }
                }
              )
            )
            requestAnimationFrame(sample)
          }
          sample()
        })
        await click()
        await page.locator(`[data-local-tab-content="${to}"]`).waitFor()
        await page.waitForTimeout(250)
        const frames = await page.evaluate(() => {
          window.sampleFade = false
          return window.fadeFrames
        })
        assert(
          frames.some((frame) =>
            frame.some(
              (p) => p.key !== String(to) && p.opacity > 0 && p.opacity < 1
            )
          ),
          'outgoing opacity fade observed'
        )
        assert(
          frames.some((frame) =>
            frame.some(
              (p) => p.key === String(to) && p.opacity > 0 && p.opacity < 1
            )
          ),
          'incoming opacity fade observed'
        )
        const outgoing = frames
          .flat()
          .filter((p) => p.key !== String(to))
          .map((p) => p.opacity)
        const incoming = frames
          .flat()
          .filter((p) => p.key === String(to))
          .map((p) => p.opacity)
        const summarize = (values) => ({
          start: values[0],
          middle: values.reduce((best, value) =>
            Math.abs(value - 0.5) < Math.abs(best - 0.5) ? value : best
          ),
          end: values[values.length - 1],
        })
        for (const values of [outgoing, incoming]) {
          assert(
            values.some((value) => value >= 0.35 && value <= 0.65),
            'clearly rendered half-opacity frame'
          )
          assert(
            values.some((value) => value <= 0.1),
            'clearly rendered near-transparent frame'
          )
          assert(
            values.some((value) => value >= 0.95),
            'clearly rendered opaque frame'
          )
        }
        console.log(width, 'opacity frames into', to, {
          outgoing: summarize(outgoing),
          incoming: summarize(incoming),
        })
        fs.writeFileSync(
          path.join(output, `${width}-${to}-frames.json`),
          JSON.stringify(frames, null, 2)
        )
        for (const frame of frames) {
          assert(
            frame.length === 1,
            'no blank/intermediate panel or overlapping panels'
          )
          for (const panel of frame) {
            if (!emptyDestination)
              assert(
                !/No (active|sold) listings yet/.test(panel.text),
                'no intermediate empty-state flash'
              )
            assert.equal(panel.transform, 'none')
            assert.equal(panel.filter, 'none')
            const same = frames.flat().find((p) => p.key === panel.key)
            assert(Math.abs(panel.x - same.x) < 0.1)
            assert(Math.abs(panel.y - same.y) < 0.1)
            assert(Math.abs(panel.width - same.width) < 0.1)
          }
        }
        for (const node of controlNodes)
          assert(
            await node.evaluate((el) => el.isConnected),
            'controls were not remounted'
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
          baseline,
          'control geometry and opacity unchanged'
        )
        assert.equal(
          await page
            .locator(`[data-local-tab-content="${to}"]`)
            .evaluate((el) => getComputedStyle(el).opacity),
          '1'
        )
        await page.screenshot({ path: path.join(output, `${width}-${to}.png`) })
      }
      if (!desktop) {
        // The local selectors remain outside the content wrapper; dropdown expansion has its own accepted motion.
        const controls = page.locator('[data-home-mobile-header] > span')
        for (const to of ['analytics', 'payment', 'overview']) {
          await page
            .locator('[data-smooth-dropdown]')
            .getByRole('button', { name: 'Show more', exact: true })
            .click()
          await page.waitForTimeout(350)
          await fade(
            to,
            () =>
              page
                .locator('[data-smooth-dropdown]')
                .getByRole('button', {
                  name: to[0].toUpperCase() + to.slice(1),
                  exact: true,
                })
                .click(),
            controls
          )
          if (to === 'analytics') {
            await page.waitForTimeout(1550)
            assert.equal(
              await page.evaluate(() => window.chartStarts.length),
              2
            )
            const node = await page
              .getByRole('button', { name: 'Overall', exact: true })
              .elementHandle()
            await select('Profile', 'Analytics')
            await page.waitForTimeout(1800)
            assert.equal(
              await page.evaluate(() => window.chartStarts.length),
              4
            )
            assert(
              await node.evaluate((el) => el.isConnected),
              'Analytics re-tap retains its controls'
            )
          }
        }
      } else {
        assert.equal(
          await page.locator('[data-local-tab-content]').count(),
          0,
          'desktop Profile is not wrapped'
        )
      }
      await select('Listings', 'My Listings')
      await page.waitForTimeout(600)
      const workspace = page.getByRole('region', {
        name: 'My Listings',
        exact: true,
      })
      const controls = workspace.locator(
        '[role="tablist"], [data-market-controls]'
      )
      const scroll = desktop
        ? page.locator('[data-home-main]')
        : page.locator('html')
      await scroll.evaluate((el) => {
        el.scrollTop = 20
      })
      await page.waitForTimeout(500)
      const beforeScroll = await scroll.evaluate((el) => el.scrollTop)
      await fade(
        1,
        () => workspace.getByRole('tab', { name: 'Sold', exact: true }).click(),
        controls
      )
      assert.equal(
        await scroll.evaluate((el) => el.scrollTop),
        beforeScroll,
        'no scroll reset on Sold'
      )
      assert.equal(await workspace.getByRole('article').count(), 12)
      await fade(
        0,
        () =>
          workspace.getByRole('tab', { name: 'Active', exact: true }).click(),
        controls
      )
      assert.equal(
        await scroll.evaluate((el) => el.scrollTop),
        beforeScroll,
        'no scroll reset on Active'
      )
      assert.equal(await workspace.getByRole('article').count(), 12)
      await page.emulateMedia({ reducedMotion: 'reduce' })
      await workspace.getByRole('tab', { name: 'Sold', exact: true }).click()
      await page.waitForTimeout(30)
      assert.equal(
        await workspace
          .locator('[data-local-tab-content="1"]')
          .evaluate((el) => getComputedStyle(el).opacity),
        '1',
        'reduced motion switches without a fade'
      )
      // A real empty destination is shown only after the populated outgoing panel fades.
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      rows = rows.filter((r) => r.status === 'available')
      await page.evaluate(() =>
        window.dispatchEvent(new window.Event('marketplace-listings-changed'))
      )
      await workspace.locator('[data-workspace-empty]').waitFor()
      await workspace.getByRole('tab', { name: 'Active', exact: true }).click()
      await page.waitForTimeout(350)
      await fade(
        1,
        () => workspace.getByRole('tab', { name: 'Sold', exact: true }).click(),
        controls,
        true
      )
      // Frozen pre-refactor empty-text positions at this test's 900px height.
      // Header/body spacing may change; the accepted text anchor must not.
      const placement = await workspace
        .locator('[data-workspace-empty] p')
        .evaluate((el) => el.getBoundingClientRect().y)
      assert(
        Math.abs(placement - (desktop ? 382.21875 : 394.0625)) < 0.1,
        'empty-state screen position preserved'
      )
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        ),
        true
      )
      assert.deepEqual(errors, [])
      assert.deepEqual(writes, [])
      console.log(
        `PASS ${width}: content-only fades, unchanged control nodes/geometry, opacity-only motion, populated and empty Active/Sold, stable scroll, reduced motion${
          desktop
            ? ', desktop Profile untouched'
            : ', mobile Overview/Analytics/Payment and Analytics re-tap'
        }`
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
