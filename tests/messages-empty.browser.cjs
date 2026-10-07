/* global getComputedStyle, Navigator */
// Isolated local UI fixtures: all API requests are intercepted; no database calls.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const base = process.env.HOME_TEST_URL
  assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  const directory = 'tests/artifacts/messages-empty'
  fs.mkdirSync(directory, { recursive: true })
  const results = []
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
      let populated = false
      const entries = (role) =>
        [4, 1, 3, 2].map((n) => ({
          id: `${role}-${n}`,
          role,
          person: { id: 'other', name: `Person ${n}` },
          listing: {
            id: `listing-${n}`,
            liveId: null,
            title: `Listing ${n}`,
            price: 10,
            currency: 'CAD',
            category: 'Other',
            photoUrls: [],
            availability: 'deleted',
          },
          createdAt: '2026-10-01T00:00:00Z',
          lastMessageAt: `2026-10-0${n}T00:00:00Z`,
          activityAt: `2026-10-0${n}T00:00:00Z`,
          lastMessage: `Text ${n}`,
          lastMessageSequence: 0,
          lastReadSequence: 0,
          unreadCount: 1,
        }))
      await page.route('**/*', (route) => {
        const url = new URL(route.request().url())
        if (url.origin !== new URL(base).origin) return route.abort()
        if (!url.pathname.startsWith('/api/')) return route.continue()
        assert.equal(route.request().method(), 'GET')
        let json = []
        if (url.pathname === '/api/auth/session')
          json = { seller: { id: 'owner', displayName: 'Fixture' } }
        else if (url.pathname === '/api/profile/account')
          json = {
            username: 'Fixture',
            email: 'fixture@uwo.ca',
            emailVerified: true,
            createdAt: '2026-10-01',
            nextUsernameChangeAt: null,
          }
        else if (url.pathname === '/api/messages/conversations')
          json = {
            conversations: populated
              ? entries(url.searchParams.get('role'))
              : [],
            nextCursor: null,
          }
        else if (url.pathname.endsWith('/messages'))
          json = { messages: [], nextBefore: null }
        return route.fulfill({ json })
      })
      const nav = page.locator(
        mobile ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
      )
      const select = async (group, child) => {
        if (mobile) {
          const toggle = nav.getByRole('button', {
            name: 'Open Home navigation',
            exact: true,
          })
          if ((await toggle.getAttribute('aria-expanded')) === 'false')
            await toggle.click()
        } else await nav.hover()
        const parent = nav.getByRole(mobile ? 'button' : 'link', {
          name: group,
          exact: true,
        })
        if (!mobile || (await parent.getAttribute('aria-expanded')) !== 'true')
          await parent.click()
        await nav.getByRole('button', { name: child, exact: true }).click()
        if (!mobile) await page.mouse.move(width - 10, 500)
        await page.waitForTimeout(500)
      }
      await page.goto(base + '/home', { waitUntil: 'domcontentloaded' })
      await select('Listings', 'Favorites')
      const favorites = page.getByRole('region', {
        name: 'Favorites',
        exact: true,
      })
      await favorites.getByText('No favorites yet.', { exact: true }).waitFor()
      const textStyle = (element) => {
        const css = getComputedStyle(element)
        return [
          css.color,
          css.fontSize,
          css.fontWeight,
          css.lineHeight,
          css.textAlign,
        ]
      }
      const favoriteStyle = await favorites
        .locator('[data-workspace-empty] p')
        .evaluate(textStyle)
      for (const role of ['Buying', 'Selling']) {
        await select('Messages', role)
        const region = page.getByRole('region', {
          name: 'Messages',
          exact: true,
        })
        await region
          .getByText('No conversations yet.', { exact: true })
          .waitFor()
        assert.equal(
          await region
            .locator('[data-client-card], [data-mobile-messages]')
            .count(),
          0
        )
        assert.deepEqual(
          await region.locator('[data-workspace-empty] p').evaluate(textStyle),
          favoriteStyle
        )
        const bounds = await region
          .locator('[data-content-state-anchor]')
          .boundingBox()
        assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
        await page.screenshot({
          path: `${directory}/${width}-${role.toLowerCase()}-empty.png`,
        })
      }
      populated = true
      await page.reload({ waitUntil: 'domcontentloaded' })
      await select('Messages', 'Buying')
      const region = page.getByRole('region', { name: 'Messages', exact: true })
      const rows = region.locator('[data-conversation-id]')
      await rows.first().waitFor()
      assert.equal(await region.locator('[data-workspace-empty]').count(), 0)
      assert.equal(await rows.count(), mobile ? 4 : 3)
      assert.equal(
        await rows.first().getAttribute('data-conversation-id'),
        'buying-4'
      )
      assert(await region.locator('[data-conversation-unread]').count())
      if (!mobile) {
        const expand = region.getByRole('button', {
          name: 'Expand conversations',
        })
        assert.equal(await expand.innerText(), '+1')
        await expand.click()
        await region.locator('[data-conversation-list]').waitFor()
        await page.waitForTimeout(600)
        assert.equal(
          await region
            .locator('[data-conversation-list] [data-conversation-id]')
            .count(),
          4
        )
      }
      await region.locator('[data-conversation-id="buying-2"]').click()
      await region.getByRole('region', { name: 'Chat panel' }).waitFor()
      await region
        .getByRole('region', { name: 'Chat panel' })
        .getByText('Person 2', { exact: true })
        .waitFor()
      if (mobile) {
        await region
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        await rows.first().waitFor({ state: 'visible' })
      }
      await page.waitForTimeout(600)
      await page.screenshot({ path: `${directory}/${width}-populated.png` })
      assert.deepEqual(errors, [])
      results.push({
        width,
        emptyBuying: 'PASS',
        emptySelling: 'PASS',
        favoritesStyle: 'MATCH',
        populated: 'PASS',
      })
      await page.close()
    }
    fs.writeFileSync(
      `${directory}/results.json`,
      JSON.stringify(results, null, 2)
    )
    console.log(JSON.stringify(results, null, 2))
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
