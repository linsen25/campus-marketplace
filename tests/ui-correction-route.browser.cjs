/* global window, document, getComputedStyle, Element, MutationObserver, Navigator */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const sharp = require('sharp')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const output = path.join(process.env.TEMP, 'ui-correction-route')
fs.mkdirSync(output, { recursive: true })
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = [],
        writes = []
      const listings = Array.from({ length: 24 }, (_, i) => ({
        id: `fixture-${i}`,
        title: `Listing ${i}`,
        price: 8500,
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
      }))
      await page.addInitScript(() => {
        delete Navigator.prototype.serviceWorker
      })
      page.on('pageerror', (e) => errors.push(e.message))
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/**', (r) => {
        const p = new URL(r.request().url()).pathname
        if (r.request().method() !== 'GET') {
          writes.push(p)
          return r.fulfill({ status: 501, json: { error: 'Blocked write' } })
        }
        if (p === '/api/auth/session')
          return r.fulfill({
            json: { seller: { id: 'owner', displayName: 'Chris' } },
          })
        if (p === '/api/profile/account')
          return r.fulfill({
            json: {
              username: 'Chris',
              email: 'chris@uwo.ca',
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
        if (p === '/api/listings') return r.fulfill({ json: listings })
        return r.fulfill({ json: [] })
      })
      await page.route('**/_next/data/**/listings.json*', (r) =>
        r.fulfill({
          json: {
            pageProps: {
              listings,
              values: {
                status: 'available',
                sort: 'newest',
                search: '',
                category: '',
                condition: '',
              },
              page: 1,
              hasNextPage: false,
              error: null,
            },
            __N_SSP: true,
          },
        })
      )
      await page.goto('http://localhost:3100/home', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      await page
        .locator('[data-slot="home-sidebar-demo"] canvas[data-rendered="true"]')
        .waitFor()
      await page.evaluate(() => {
        const animate = Element.prototype.animate
        Element.prototype.animate = function (...args) {
          const animation = animate.apply(this, args)
          if (this.hasAttribute('data-route-track')) {
            animation.pause()
            window.routeAuditAnimation = animation
          }
          return animation
        }
      })
      await page.evaluate(() => {
        window.chartStarts = []
        const phases = new WeakMap()
        new MutationObserver((records) => {
          for (const el of new Set(records.map((r) => r.target))) {
            const phase = el.getAttribute('data-chart-animation')
            if (phase === 'running' && phases.get(el) !== 'running')
              window.chartStarts.push(el.getAttribute('data-chart-replay'))
            phases.set(el, phase)
          }
        }).observe(document.body, {
          subtree: true,
          attributes: true,
          attributeFilter: ['data-chart-animation'],
        })
      })
      const cdp = await page.context().newCDPSession(page)
      for (const destination of ['/listings', '/home', '/listings', '/home']) {
        const name = destination === '/home' ? 'market-home' : 'home-market'
        const control =
          destination === '/home'
            ? page
                .getByRole('navigation', { name: 'Market navigation' })
                .getByRole('link', { name: 'Home', exact: true })
            : page.getByRole('link', { name: 'Back to Market', exact: true })
        if (destination === '/listings') {
          const r = await control.boundingBox()
          assert.equal(r.width, 48)
          assert.equal(r.height, 48)
          const icon = await control.locator('svg').boundingBox()
          console.log(width, 'back circle/icon', r.width, icon.width)
        } else {
          assert.equal(await control.locator('[class*="sweep"]').count(), 0)
          assert.equal(
            await control.evaluate(
              (el) => getComputedStyle(el).backgroundColor
            ),
            'rgb(255, 255, 255)'
          )
          assert.equal(
            await page.locator('h1 span[aria-hidden]').textContent(),
            '\u2726'
          )
          assert((await page.locator('[data-market-card]').count()) > 0)
        }
        const original = await page
          .locator('[data-route-surface]')
          .evaluate((el) => {
            const r = el.getBoundingClientRect()
            const title = el
              .querySelector('h1, [data-home-section-header] h2')
              .getBoundingClientRect()
            return { width: r.width, titleX: title.x, titleY: title.y }
          })
        const startsBefore = await page.evaluate(
          () => window.chartStarts.length
        )
        await control.click({ noWaitAfter: true })
        await page.waitForFunction(() => !!window.routeAuditAnimation)
        const timing = await page.evaluate(() =>
          window.routeAuditAnimation.effect.getTiming()
        )
        assert.equal(timing.duration, 380)
        assert.equal(timing.easing, 'cubic-bezier(0.42, 0, 1, 1)')
        for (const fraction of [0, 0.1, 0.25, 0.5, 0.75, 1]) {
          await page.evaluate(
            (f) => (window.routeAuditAnimation.currentTime = 380 * f),
            fraction
          )
          await page.waitForTimeout(35)
          assert.equal(
            await page.evaluate(() => window.chartStarts.length),
            startsBefore,
            'no replay during paused slide frames'
          )
          const geometry = await page.evaluate(() => {
            const source = document.querySelector('[data-route-source]'),
              surface = document.querySelector('[data-route-surface]'),
              track = document.querySelector('[data-route-track]')
            const a = source.getBoundingClientRect(),
              b = surface.getBoundingClientRect()
            return {
              source: { x: a.x, right: a.right, width: a.width },
              destination: { x: b.x, right: b.right, width: b.width },
              track: track.clientWidth,
              scroll: surface.clientWidth,
              html: document.documentElement.clientWidth,
              sourceChild:
                source.firstElementChild.getBoundingClientRect().width,
              sourceBackground: source
                .querySelector('canvas')
                ?.getBoundingClientRect().width,
              background: getComputedStyle(surface).backgroundColor,
            }
          })
          console.log(width, name, fraction, JSON.stringify(geometry))
          const shot = await cdp.send('Page.captureScreenshot', {
            format: 'png',
            captureBeyondViewport: false,
          })
          fs.writeFileSync(
            path.join(output, `${width}-${name}-${fraction * 100}.png`),
            Buffer.from(shot.data, 'base64')
          )
          assert.equal(
            geometry.track,
            original.width,
            'Track uses the original transition viewport'
          )
          assert(Math.abs(geometry.source.width - original.width) < 0.001)
          assert(Math.abs(geometry.destination.width - original.width) < 0.001)
          if (fraction === 0) {
            assert.equal(geometry.source.x, 0, 'No preliminary nudge')
            const title = await page
              .locator('[data-route-source]')
              .evaluate((el) => {
                const r = el
                  .querySelector('h1, [data-home-section-header] h2')
                  .getBoundingClientRect()
                return { x: r.x, y: r.y }
              })
            assert.equal(
              title.x,
              original.titleX,
              'Source content retains its original x'
            )
            assert.equal(title.y, original.titleY)
          }
          assert(
            destination === '/home'
              ? geometry.source.x <= 0
              : geometry.source.x >= 0,
            'No reverse motion'
          )
          assert.equal(geometry.background, 'rgb(11, 11, 11)')
          assert(
            Math.abs(
              destination === '/home'
                ? geometry.source.right - geometry.destination.x
                : geometry.destination.right - geometry.source.x
            ) < 0.001,
            'adjacent surfaces'
          )
          const { data, info } = await sharp(Buffer.from(shot.data, 'base64'))
            .ensureAlpha()
            .raw()
            .toBuffer({ resolveWithObject: true })
          const boundary =
            destination === '/home'
              ? geometry.destination.x
              : geometry.destination.right
          for (const x of [
            ...Array.from({ length: 5 }, (_, i) =>
              Math.max(0, Math.min(width - 1, Math.round(boundary) + i - 2))
            ),
            width - 1,
          ]) {
            let light = 0
            for (let y = 170; y < 880; y++) {
              const offset = (y * info.width + x) * 4
              if (
                data[offset] > 215 &&
                data[offset + 1] > 215 &&
                data[offset + 2] > 215
              )
                light++
            }
            assert(
              light < 70,
              `No exposed light seam at column ${x}: ${light} light pixels`
            )
          }
        }
        await page.evaluate(() => {
          window.routeAuditAnimation.play()
          window.routeAuditAnimation = null
        })
        await page
          .locator('[data-route-source]')
          .waitFor({ state: 'detached', timeout: 30000 })
        if (destination === '/home') {
          await page.waitForFunction(
            (before) => window.chartStarts.length === before + 2,
            startsBefore
          )
          await page.waitForTimeout(1800)
          assert.equal(
            await page.evaluate(() => window.chartStarts.length),
            startsBefore + 2,
            'one replay per chart after route release'
          )
          console.log(
            width,
            'Market/Home arrival: two charts replayed exactly once after slide, stable afterward'
          )
        }
      }
      assert.deepEqual(errors, [])
      assert.deepEqual(writes, [])
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
