/* global window, document, MutationObserver, HTMLElement */
// Main localhost app/router; anonymous session, browser-only failure injection.
// No login, transaction fixtures, hosted writes, or production access.
const assert = require('node:assert/strict')
const {
  chromium,
} = require('./artifacts/browser-tools/node_modules/playwright-core')
const base = process.env.TEST_BASE_URL || 'http://localhost:3000'
async function main() {
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      page.setDefaultTimeout(30000)
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/auth/session', (r) =>
        r.fulfill({ json: { seller: null } })
      )
      await page.route('**/_next/data/**/listings.json*', (r) =>
        r.fulfill({
          json: {
            pageProps: {
              listings: [],
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
      await page.addInitScript(() => {
        window.navCalls = []
        // Missing decorative first-paint evidence used to veto a completed route.
        new MutationObserver(() => {
          for (const c of document.querySelectorAll(
            '[data-slot="home-sidebar-demo"] canvas[data-rendered]'
          ))
            c.removeAttribute('data-rendered')
        }).observe(document, {
          subtree: true,
          childList: true,
          attributes: true,
          attributeFilter: ['data-rendered'],
        })
        const animate = HTMLElement.prototype.animate
        HTMLElement.prototype.animate = function (...args) {
          if (window.failSlide && this.matches('[data-route-track]')) {
            window.failSlide = false
            throw Error('Controlled visual animation failure')
          }
          return animate.apply(this, args)
        }
      })
      const stable = async (path) => {
        await page.waitForURL((url) => url.pathname === path)
        await page.locator('[data-route-source]').waitFor({ state: 'detached' })
        await page
          .locator(
            path === '/home'
              ? '[data-slot="home-sidebar-demo"]'
              : '[data-discover]'
          )
          .waitFor()
        assert.equal(
          await page.locator('[data-route-surface]').getAttribute('inert'),
          null
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
      }
      const home = async () => {
        if (width >= 1024)
          await page
            .getByRole('navigation', { name: 'Market navigation' })
            .getByRole('link', { name: 'Home', exact: true })
            .click({ noWaitAfter: true })
        else
          await page
            .getByRole('tab', { name: 'Home', exact: true })
            .click({ noWaitAfter: true })
        await stable('/home')
        assert.equal(await page.locator('[data-discover]').count(), 0)
      }
      const market = async () => {
        if (width >= 1024)
          await page
            .getByRole('link', { name: 'Back to Market', exact: true })
            .click({ noWaitAfter: true })
        else
          await page
            .getByRole('tab', { name: 'Market', exact: true })
            .click({ noWaitAfter: true })
        await stable('/listings')
      }
      await page.goto(base + '/listings', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await page.waitForFunction(() => !!window.next?.router)
      await page.evaluate(() => {
        const r = window.next.router
        for (const name of ['push', 'replace']) {
          const original = r[name]
          r[name] = function (...args) {
            window.navCalls.push([name, args[0]])
            return original.apply(this, args)
          }
        }
      })
      const controlHeight = 48
      const search = page.getByRole('button', {
        name: 'Open search',
        exact: true,
      })
      assert.deepEqual(
        await search.locator('..').evaluate((e) => {
          const r = e.getBoundingClientRect()
          return [r.width, r.height]
        }),
        [controlHeight, controlHeight]
      )
      await page.evaluate(
        () => (window.searchBefore = document.querySelector('[data-discover]'))
      )
      await search.click()
      await page.waitForTimeout(500)
      assert.equal(await search.getAttribute('aria-expanded'), 'true')
      await page
        .getByRole('button', { name: 'Close search', exact: true })
        .click()
      await page.waitForTimeout(500)
      assert(
        await page.evaluate(
          () =>
            window.searchBefore === document.querySelector('[data-discover]')
        )
      )
      await page.getByRole('button', { name: 'Shop', exact: true }).waitFor()
      await home()
      assert(
        !(await page.evaluate(() => window.navCalls)).some(
          ([name]) => name === 'replace'
        )
      )
      // Home -> Messages uses the existing local sidebar/dropdown flow.
      if (width >= 1024)
        await page.getByRole('link', { name: 'Messages', exact: true }).click()
      else {
        const menu = page.locator('[data-smooth-dropdown]')
        await menu.getByRole('button', { name: 'Open Home navigation' }).click()
        await menu
          .getByRole('button', { name: 'Messages', exact: true })
          .click()
        await menu.getByRole('button', { name: 'Buying', exact: true }).click()
      }
      await page
        .getByRole('region', { name: 'Messages', exact: true })
        .waitFor()
      await market()
      await page.goBack()
      await stable('/home')
      await page.goForward()
      await stable('/listings')
      // Even a rejected visual animation may not roll Home back to Market.
      await page.evaluate(() => (window.failSlide = true))
      await home()
      assert(
        !(await page.evaluate(() => window.navCalls)).some(
          ([name]) => name === 'replace'
        )
      )
      await page.goto(base + '/home?section=notifications', {
        waitUntil: 'domcontentloaded',
      })
      await page
        .getByRole('heading', { name: 'Notifications', exact: true })
        .waitFor()
      await page.goto(base + '/home?section=messages&destination=buying', {
        waitUntil: 'domcontentloaded',
      })
      await page
        .getByRole('region', { name: 'Messages', exact: true })
        .waitFor()
      await page.goto(base + '/home', { waitUntil: 'domcontentloaded' })
      await page.locator('[data-slot="home-sidebar-demo"]').waitFor()
      await market()
      // Router rejection before commitment leaves the same Market/Search live.
      await page.evaluate(() => {
        window.searchBefore = document.querySelector('[data-discover]')
        window.next.router.push = () =>
          Promise.reject(Error('Controlled router failure'))
      })
      if (width >= 1024)
        await page
          .getByRole('navigation', { name: 'Market navigation' })
          .getByRole('link', { name: 'Home', exact: true })
          .click({ noWaitAfter: true })
      else
        await page
          .getByRole('tab', { name: 'Home', exact: true })
          .click({ noWaitAfter: true })
      await page.waitForTimeout(300)
      assert.equal(new URL(page.url()).pathname, '/listings')
      assert(
        await page.evaluate(
          () =>
            window.searchBefore === document.querySelector('[data-discover]')
        )
      )
      assert.equal(await page.locator('[data-route-source]').count(), 0)
      console.log(
        'PASS ' +
          width +
          ': real Home/Market router, missing-background and animation-failure recovery, Search identity/open/close, Messages/Notifications/direct routes, Back/Forward, no overflow; existing ' +
          controlHeight +
          'px controls unchanged'
      )
      await page.close()
    }
    const page = await browser.newPage({
      viewport: { width: 1280, height: 900 },
      serviceWorkers: 'block',
    })
    await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
      r.abort()
    )
    await page.route('**/api/auth/session', (r) =>
      r.fulfill({ json: { seller: null } })
    )
    await page.goto(base + '/auth/sign-in', { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => window.next?.router?.isReady)
    await page
      .getByRole('button', { name: 'Close authentication', exact: true })
      .click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Home', exact: true })
      .click()
    await page.locator('[data-slot="home-sidebar-demo"]').waitFor()
    assert.equal(new URL(page.url()).pathname, '/home')
    console.log('PASS shared Auth header -> Home normal link navigation')
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
