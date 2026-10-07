/* global Navigator, getComputedStyle, document, innerWidth */
/* eslint-disable no-inner-declarations -- Each viewport owns isolated network gates. */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
const base = process.env.HOME_TEST_URL || 'http://localhost:3100'
const categories = [
  'Electronics',
  'Home & Dorm',
  'Textbooks & School',
  'Clothing & Accessories',
  'Sports & Outdoors',
  'Bikes & Mobility',
  'Games & Hobbies',
  'Other',
]

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
      })
      const gates = {
          account: [],
          categories: [],
          listings: [],
          favorites: [],
        },
        calls = [],
        errors = []
      let failure = true
      let categoryEmpty = false
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      await page.route('**/api/**', async (route) => {
        assert.equal(route.request().method(), 'GET', 'no verification writes')
        const path = new URL(route.request().url()).pathname
        calls.push(path)
        if (path === '/api/auth/session')
          return route.fulfill({
            json: { seller: { id: 'owner', displayName: 'Fixture' } },
          })
        if (path === '/api/profile/account') {
          await new Promise((resolve) => gates.account.push(resolve))
          return route.fulfill({
            json: {
              username: 'Fixture',
              email: 'fixture@uwo.ca',
              emailVerified: true,
              createdAt: '2026-10-01',
              nextUsernameChangeAt: null,
            },
          })
        }
        if (path === '/api/profile/categories') {
          await new Promise((resolve) => gates.categories.push(resolve))
          return route.fulfill({
            json: categories.map((category, index) => ({
              category,
              count: categoryEmpty ? 0 : index + 1,
            })),
          })
        }
        if (path === '/api/listings' || path === '/api/favorites') {
          const key = path.split('/').pop()
          await new Promise((resolve) => gates[key].push(resolve))
          return route.fulfill(
            failure
              ? { status: 500, json: { error: 'Fixture request failed.' } }
              : { json: [] }
          )
        }
        return route.fulfill({ json: [] })
      })
      async function release(key) {
        for (let n = 0; n < 200 && !gates[key].length; n++)
          await page.waitForTimeout(10)
        assert(gates[key].length)
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
          if (child)
            await rail.getByRole('button', { name: child, exact: true }).click()
          await page.mouse.move(width - 20, 500)
        }
        await page.waitForTimeout(400)
      }
      const rect = (locator) =>
        locator.evaluate((node) => {
          const r = node.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        })
      const center = (locator) =>
        locator.evaluate((node) => {
          const r = node.getBoundingClientRect()
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
        })
      async function stable(before, locator, label) {
        const after = await rect(locator)
        for (const key of ['x', 'y', 'width', 'height'])
          assert(
            Math.abs(after[key] - before[key]) < 0.1,
            `${label} ${key}: ${before[key]} -> ${after[key]}`
          )
        console.log(width, label, 'shift 0px', after)
      }
      await page.goto(base + '/home', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      const account = page
        .locator('[data-profile-account]')
        .filter({ visible: true })
      await account.locator('[data-slot="skeleton"]').first().waitFor()
      assert.equal(
        await account.locator('[data-content-loading-spinner]').count(),
        0
      )
      const accountBefore = await rect(account)
      const activity = page.getByRole('region', {
        name: 'Your Activity',
        exact: true,
      })
      const activityBefore = width >= 1024 ? await rect(activity) : null
      await page.screenshot({
        path: process.env.TEMP + `/home-skeleton-${width}-account.png`,
      })
      const skeleton = account.locator('[data-slot="skeleton"]').first()
      const animation = await skeleton.evaluate(
        (node) => getComputedStyle(node, '::after').animationName
      )
      assert(animation.includes('skeleton-shimmer'))
      await page.emulateMedia({ reducedMotion: 'reduce' })
      assert.equal(
        await skeleton.evaluate(
          (node) => getComputedStyle(node, '::after').animationName
        ),
        'none'
      )
      await page.emulateMedia({ reducedMotion: 'no-preference' })
      await release('account')
      await account.getByText('fixture@uwo.ca', { exact: true }).waitFor()
      await page.waitForTimeout(200)
      await stable(accountBefore, account, 'account replacement')
      if (activityBefore)
        await stable(
          activityBefore,
          activity,
          'charts after account replacement'
        )
      if (width < 1024) await select('Profile', 'Analytics')
      const trends = page.getByRole('region', {
        name: 'Marketplace Trends',
        exact: true,
      })
      await trends.locator('[data-slot="skeleton"]').first().waitFor()
      assert.equal(await trends.locator('[data-slot="skeleton"]').count(), 16)
      assert.equal(
        await trends.locator('[data-content-loading-spinner]').count(),
        0
      )
      const trendsBefore = await rect(trends),
        activityPending = await rect(activity)
      await page.screenshot({
        path: process.env.TEMP + `/home-skeleton-${width}-trends.png`,
      })
      await release('categories')
      await trends.locator('.recharts-wrapper').waitFor()
      await page.waitForTimeout(250)
      await stable(trendsBefore, trends, 'trends replacement')
      await stable(
        activityPending,
        activity,
        'activity after trends replacement'
      )
      await select('Settings')
      await account.locator('[data-slot="skeleton"]').first().waitFor()
      const settingsBefore = await rect(account)
      await release('account')
      await account
        .getByRole('button', { name: 'Change username', exact: true })
        .waitFor()
      await page.waitForTimeout(200)
      await stable(settingsBefore, account, 'settings replacement')
      categoryEmpty = true
      await select('Profile', width < 1024 ? 'Analytics' : undefined)
      await trends.locator('[data-slot="skeleton"]').first().waitFor()
      const emptyTrendsBefore = await rect(trends)
      await release('categories')
      await trends
        .getByText('No active listings yet.', { exact: true })
        .waitFor()
      await page.waitForTimeout(200)
      await stable(emptyTrendsBefore, trends, 'trends empty replacement')
      await select('Messages', 'Buying')
      const messages = page.getByRole('region', {
        name: 'Messages',
        exact: true,
      })
      const header = page
        .locator('[data-home-section-header]')
        .filter({ visible: true })
      assert.equal(await header.innerText(), 'Messages')
      const apiBefore = calls.length
      assert.equal(await messages.getByRole('tab').count(), 0)
      const card = messages.locator('[data-client-card]')
      assert((await rect(card)).width <= (await rect(messages)).width)
      const avatarColors = () =>
        card.locator('[data-avatar-color]').evaluateAll((nodes) =>
          nodes.map((node) => ({
            name: node.textContent,
            color: getComputedStyle(node).backgroundColor,
          }))
        )
      const colors = await avatarColors()
      await messages
        .getByRole('button', { name: 'Expand recent people', exact: true })
        .click()
      await messages
        .getByRole('button', { name: 'Go Back', exact: true })
        .waitFor()
      await page.waitForTimeout(400)
      await page.screenshot({
        path: process.env.TEMP + `/messages-${width}-expanded.png`,
      })
      await messages
        .getByRole('button', { name: 'Go Back', exact: true })
        .click()
      await messages
        .getByRole('button', { name: 'Go Back', exact: true })
        .waitFor({ state: 'detached' })
      await page.waitForTimeout(500)
      assert.deepEqual(await avatarColors(), colors)
      await select('Messages', 'Selling')
      await messages
        .getByText('Thanks! When would pickup work for you?', { exact: true })
        .waitFor()
      await select('Messages', 'Buying')
      await messages
        .getByText('Is this still available?', { exact: true })
        .waitFor()
      await page.waitForTimeout(300)
      assert.deepEqual(await avatarColors(), colors)
      assert.equal(
        calls.length,
        apiBefore,
        'Messages introduces no API request'
      )
      assert.equal(
        await messages
          .getByText(/Amount Paid|Deadline|Overdue|Professional/)
          .count(),
        0
      )
      await page.screenshot({
        path: process.env.TEMP + `/messages-${width}.png`,
      })
      for (const section of ['my-listings', 'favorites']) {
        failure = true
        await page.goto(base + '/home?section=' + section, {
          waitUntil: 'domcontentloaded',
        })
        const workspace = page.getByRole('region', {
          name: section === 'favorites' ? 'Favorites' : 'My Listings',
          exact: true,
        })
        await workspace.locator('[data-content-loading-spinner]').waitFor()
        const loadingCenter = await center(
          workspace.locator('[data-content-state-anchor]')
        )
        await release(section === 'favorites' ? 'favorites' : 'listings')
        await workspace
          .getByRole('button', { name: 'Retry', exact: true })
          .waitFor()
        assert.deepEqual(
          await center(workspace.locator('[data-content-state-anchor]')),
          loadingCenter
        )
        assert.equal(
          await workspace
            .getByRole('button', { name: 'Retry', exact: true })
            .evaluate((node) => getComputedStyle(node).backgroundColor),
          'rgb(102, 71, 128)'
        )
        await page.screenshot({
          path: process.env.TEMP + `/home-error-${width}-${section}.png`,
        })
        failure = false
        await workspace
          .getByRole('button', { name: 'Retry', exact: true })
          .click()
        await workspace.locator('[data-content-loading-spinner]').waitFor()
        await release(section === 'favorites' ? 'favorites' : 'listings')
        await workspace.locator('[data-workspace-empty]').waitFor()
        assert.deepEqual(
          await center(workspace.locator('[data-content-state-anchor]')),
          loadingCenter
        )
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth
        ),
        false
      )
      assert.deepEqual(errors, [])
      await page.close()
      console.log(
        'PASS',
        width,
        'structured Skeletons, zero shift, static reduced motion, anchored errors/retry, supplied Client Card, stable avatars, no Messages API'
      )
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
