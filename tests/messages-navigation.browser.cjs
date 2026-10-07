/* global Navigator, document, innerWidth, getComputedStyle */
const assert = require('node:assert/strict')
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
      })
      const calls = [],
        errors = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(
        /https:\/\/fonts\.(googleapis|gstatic)\.com\//,
        (route) => route.abort()
      )
      await page.route('**/api/**', (route) => {
        assert.equal(route.request().method(), 'GET')
        const path = new URL(route.request().url()).pathname
        calls.push(path)
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
        (process.env.HOME_TEST_URL || 'http://localhost:3100') + '/home',
        { waitUntil: 'domcontentloaded' }
      )
      const nav = page.locator(
        width < 1024 ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
      )
      const group = async () => {
        if (width < 1024)
          await nav
            .getByRole('button', { name: 'Open Home navigation', exact: true })
            .click()
        else await nav.hover()
        await nav
          .getByRole(width < 1024 ? 'button' : 'link', {
            name: 'Messages',
            exact: true,
          })
          .click()
        await page.waitForTimeout(400)
      }
      const child = async (name) => {
        if (
          width < 1024 &&
          (await nav
            .getByRole('button', { name: 'Open Home navigation', exact: true })
            .getAttribute('aria-expanded')) === 'false'
        )
          await nav
            .getByRole('button', { name: 'Open Home navigation', exact: true })
            .click()
        if (width >= 1024) await nav.hover()
        await nav.getByRole('button', { name, exact: true }).click()
        if (width >= 1024) await page.mouse.move(width - 20, 500)
        await page.waitForTimeout(400)
      }
      await group()
      const messages = page.getByRole('region', {
        name: 'Messages',
        exact: true,
      })
      const card = messages.locator('[data-client-card]')
      await card.waitFor()
      if (!process.env.MESSAGES_BEFORE) {
        for (const name of ['Buying', 'Selling'])
          assert(
            await nav.getByRole('button', { name, exact: true }).isVisible()
          )
        assert.equal(
          await nav
            .getByRole('button', { name: 'Buying', exact: true })
            .getAttribute('aria-current'),
          'page'
        )
        assert.equal(await messages.getByRole('tab').count(), 0)
        assert.equal(
          await messages
            .getByRole('button', { name: /Buying|Selling/ })
            .count(),
          0
        )
        assert.equal(
          await messages.locator('[data-local-tab-content]').count(),
          0
        )
        assert.equal(
          await page
            .locator(
              width < 1024
                ? '[data-home-mobile-header] h1'
                : '[data-home-section-header]'
            )
            .filter({ visible: true })
            .innerText(),
          'Messages'
        )
        await page.screenshot({
          path: process.env.TEMP + `/messages-navigation-${width}-children.png`,
        })
        if (width < 1024) await child('Buying')
      }
      if (width >= 1024) await page.mouse.move(width - 20, 500)
      await page.waitForTimeout(450)
      const box = await card.boundingBox(),
        workspace = await messages.boundingBox()
      const dimensions = await card.evaluate((node) => {
        const rect = (element) => {
          const r = element.getBoundingClientRect()
          return { width: r.width, height: r.height }
        }
        return {
          rail: rect(node.firstElementChild),
          tile: rect(
            node.firstElementChild.querySelector('[data-avatar-color]')
              .parentElement
          ),
          body: rect(node.lastElementChild),
        }
      })
      console.log(
        JSON.stringify({
          width,
          phase: process.env.MESSAGES_BEFORE ? 'before' : 'after',
          card: box,
          workspace,
          dimensions,
          proportion: box.width / workspace.width,
        })
      )
      if (!process.env.MESSAGES_BEFORE) {
        assert.equal(
          box.width,
          workspace.width,
          'integrated surface fills Messages workspace'
        )
        assert.deepEqual(dimensions.tile, { width: 40, height: 40 })
        assert.equal(dimensions.rail.width, 64, 'original fixed rail')
        assert.equal(
          dimensions.body.width,
          box.width - 66,
          'chat directly follows the rail and surface border'
        )
        assert.equal(
          box.height,
          workspace.height,
          'root fills its workspace row'
        )
        assert.equal(dimensions.body.height, box.height - 2)
        assert.equal(dimensions.rail.height, box.height - 2)
        const assertOriginalRail = async () => {
          assert.equal(
            await card
              .locator(':scope > div:first-child [data-conversation-id]')
              .count(),
            3
          )
          assert.equal(
            await card
              .getByRole('button', {
                name: 'Expand conversations',
                exact: true,
              })
              .innerText(),
            '+15'
          )
          assert.equal(
            await card
              .locator(':scope > div:first-child > div')
              .evaluate((node) => node.getBoundingClientRect().height),
            186
          )
        }
        await assertOriginalRail()
        await page.setViewportSize({ width, height: 720 })
        await page.waitForTimeout(300)
        assert.equal(
          (await card.boundingBox()).height,
          box.height - 180,
          'height follows viewport shrink, not the old visible count'
        )
        await assertOriginalRail()
        await page.setViewportSize({ width, height: 900 })
        await page.waitForTimeout(300)
        const apiBefore = calls.length
        const colors = () =>
          card
            .locator('[data-avatar-color]')
            .evaluateAll((nodes) =>
              nodes.map((node) => getComputedStyle(node).backgroundColor)
            )
        const beforeColors = await colors()
        await child('Selling')
        await messages
          .getByRole('heading', { name: 'Alex Chen', exact: true })
          .waitFor()
        await assertOriginalRail()
        const sellingIds = await card
          .locator(':scope > div:first-child [data-conversation-id]')
          .evaluateAll((nodes) =>
            nodes.map((node) => node.dataset.conversationId)
          )
        await card
          .getByRole('button', { name: 'Expand conversations', exact: true })
          .click()
        await card
          .getByRole('button', { name: 'Go Back', exact: true })
          .waitFor()
        await page.waitForTimeout(450)
        const sellingGrid = card
          .getByRole('button', { name: 'Go Back', exact: true })
          .locator('../..')
        const expandedSellingIds = await sellingGrid
          .locator('[data-conversation-id]')
          .evaluateAll((nodes) =>
            nodes.map((node) => node.dataset.conversationId)
          )
        assert.equal(expandedSellingIds.length, 18)
        assert.deepEqual(
          expandedSellingIds.slice(0, sellingIds.length),
          sellingIds
        )
        await page.screenshot({
          path: process.env.TEMP + `/messages-selling-${width}-expanded.png`,
        })
        await card.getByRole('button', { name: 'Go Back', exact: true }).click()
        await card
          .getByRole('button', { name: 'Go Back', exact: true })
          .waitFor({ state: 'detached' })
        await page.waitForTimeout(500)
        await child('Buying')
        await messages
          .getByRole('heading', { name: 'Sarah Jenkins', exact: true })
          .waitFor()
        assert.deepEqual(await colors(), beforeColors)
        await messages
          .getByRole('button', { name: 'Expand conversations', exact: true })
          .click()
        await messages
          .getByRole('button', { name: 'Go Back', exact: true })
          .waitFor()
        await page.waitForTimeout(450)
        const expanded = messages
          .getByRole('button', { name: 'Go Back', exact: true })
          .locator('../..')
        assert.equal(
          (await expanded.boundingBox()).width,
          width < 1024 ? 280 : 320
        )
        assert.equal((await expanded.boundingBox()).height, box.height - 2)
        const expandedTiles = await expanded
          .locator('[data-avatar-color]')
          .evaluateAll((nodes) =>
            nodes.map((node) => {
              const r = node.parentElement.getBoundingClientRect()
              return { width: r.width, height: r.height }
            })
          )
        assert(
          expandedTiles.every((tile) => tile.width === 40 && tile.height === 40)
        )
        assert.equal(expandedTiles.length, 18)
        await page.screenshot({
          path: process.env.TEMP + `/messages-navigation-${width}-expanded.png`,
        })
        await messages
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        await card
          .getByRole('button', { name: 'Go Back', exact: true })
          .waitFor({ state: 'detached' })
        await page.waitForTimeout(500)
        assert.deepEqual(await colors(), beforeColors)
        await child('Selling')
        await group()
        await messages
          .getByRole('heading', { name: 'Sarah Jenkins', exact: true })
          .waitFor()
        if (width < 1024) await child('Buying')
        else await page.mouse.move(width - 20, 500)
        await page.waitForTimeout(450)
        await page.screenshot({
          path: process.env.TEMP + `/messages-navigation-${width}.png`,
        })
        assert.equal(
          calls.length,
          apiBefore,
          'Messages navigation makes no API requests'
        )
        assert(
          await card.evaluate((node) => {
            const r = node.getBoundingClientRect(),
              parent = node.closest('section').getBoundingClientRect()
            return r.x >= parent.x && r.right <= parent.right + 0.1
          })
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth
          )
        )
        assert.deepEqual(errors, [])
        console.log(
          'PASS',
          width,
          'sidebar/mobile children, first-child default, no pills, card stack/back, stable avatars, no network/overflow/errors'
        )
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
