const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const mobile = width < 1024,
        page = await browser.newPage({
          viewport: { width, height: 900 },
          serviceWorkers: 'block',
        }),
        errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.addInitScript(() => delete Navigator.prototype.serviceWorker)
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/**', (r) => {
        assert.equal(r.request().method(), 'GET')
        const path = new URL(r.request().url()).pathname
        return r.fulfill({
          json:
            path === '/api/auth/session'
              ? { seller: { id: 'owner', displayName: 'Fixture' } }
              : path === '/api/profile/account'
              ? {
                  username: 'Fixture',
                  email: 'fixture@uwo.ca',
                  emailVerified: true,
                  createdAt: '2026-10-01',
                  nextUsernameChangeAt: null,
                }
              : [],
        })
      })
      await page.goto(process.env.HOME_TEST_URL + '/home', {
        waitUntil: 'domcontentloaded',
      })
      await page.waitForTimeout(1200)
      const nav = page.locator(
          mobile ? '[data-smooth-dropdown]' : '[data-slot="sidebar-body"]'
        ),
        toggle = nav.getByRole('button', {
          name: 'Open Home navigation',
          exact: true,
        })
      const open = async () => {
        if (mobile) {
          if ((await toggle.getAttribute('aria-expanded')) === 'false')
            await toggle.click()
        } else await nav.hover()
      }
      const select = async (group, child) => {
        await open()
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
        if (!mobile) await page.mouse.move(width - 10, 500)
        await page.waitForTimeout(500)
      }
      const shot = async (label) =>
        page.screenshot({
          path:
            process.env.TEMP +
            '/messages-unread-' +
            width +
            '-' +
            label +
            '.png',
        })

      await select('Messages', 'Buying')
      const workspace = page.getByRole('region', {
        name: 'Messages',
        exact: true,
      })
      const card = workspace.locator(
        mobile ? '[data-mobile-messages]' : '[data-client-card]'
      )
      const list = workspace.locator('[data-conversation-list]')
      const panel = workspace.getByRole('region', { name: 'Chat panel' })
      const rows = () => list.locator('button[data-conversation-id]')
      const order = () =>
        rows().evaluateAll((es) => es.map((e) => e.dataset.conversationId))
      const dot = (id) =>
        card.locator(
          '[data-conversation-id="' + id + '"] [data-conversation-unread]'
        )
      if (!mobile) {
        assert.deepEqual(
          await card
            .locator('[data-conversation-id]')
            .evaluateAll((es) => es.map((e) => e.dataset.conversationId)),
          [
            'buying-conversation-3',
            'buying-conversation-14',
            'buying-conversation-7',
          ]
        )
        assert.equal(
          await card
            .getByRole('button', { name: 'Expand conversations' })
            .innerText(),
          '+15'
        )
        assert.equal(
          await card.locator('[data-conversation-unread]').count(),
          2
        )
        await shot('desktop-recent-unread')
        await card.getByRole('button', { name: 'Expand conversations' }).click()
        await page.waitForTimeout(700)
      }
      const before = await order()
      assert.deepEqual(before.slice(0, 3), [
        'buying-conversation-3',
        'buying-conversation-14',
        'buying-conversation-7',
      ])
      assert.equal(before.length, 18)
      assert.equal(await dot('buying-conversation-3').count(), 1)
      assert.equal(await dot('buying-conversation-14').count(), 0)
      assert.equal(await dot('buying-conversation-0').count(), 1)
      if (mobile) {
        assert.equal(await list.locator('[aria-pressed="true"]').count(), 0)
        assert.equal(await list.locator('.shining-button__arrow').count(), 18)
      }
      const first = rows().first(),
        avatar = first.locator('span').first(),
        r = await avatar.boundingBox(),
        d = await dot('buying-conversation-3').boundingBox()
      assert.equal(r.width, 40)
      assert.equal(r.height, 40)
      assert.equal(
        await avatar.locator('[data-avatar-color]').evaluate(
          (el) => getComputedStyle(el).borderRadius
        ),
        '50%'
      )
      assert.equal(d.width, 8)
      assert.equal(d.height, 8)
      assert.equal(d.y, r.y)
      assert.equal(d.x + d.width, r.x + r.width)
      assert.equal(
        await dot('buying-conversation-3').evaluate(
          (el) => getComputedStyle(el).backgroundColor
        ),
        'rgb(239, 68, 68)'
      )
      await page.mouse.move(1, 1)
      await shot(mobile ? 'buying-list-unread' : 'desktop-expanded-unread')
      // Same person, two listings: reading AirPods must leave Sarah's Chair unread.
      await list
        .locator('[data-conversation-id="buying-conversation-3"]')
        .click()
      await page.waitForTimeout(400)
      assert.equal(await panel.locator('h3').innerText(), 'Sarah Jenkins')
      assert.equal(await panel.locator('[data-conversation-unread]').count(), 0)
      await panel
        .getByRole('button', { name: 'View listing', exact: true })
        .click()
      await page.waitForTimeout(350)
      assert.equal(
        await page.getByRole('dialog').locator('h3').innerText(),
        'AirPods Pro'
      )
      assert(
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Send to seller' })
          .isVisible()
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      if (mobile) {
        await workspace
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        await page.waitForTimeout(400)
      } else {
        await card.getByRole('button', { name: 'Expand conversations' }).click()
        await page.waitForTimeout(700)
      }
      assert.deepEqual(await order(), before)
      assert.equal(await dot('buying-conversation-3').count(), 0)
      assert.equal(await dot('buying-conversation-0').count(), 1)
      assert.equal(await dot('buying-conversation-7').count(), 1)
      await page.mouse.move(1, 1)
      await shot('buying-list-after-read')
      // Open an older unread item: it must NOT be promoted to recent #1.
      await list
        .locator('[data-conversation-id="buying-conversation-0"]')
        .click()
      await page.waitForTimeout(400)
      if (mobile) {
        await workspace
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        await page.waitForTimeout(400)
      } else {
        await card.getByRole('button', { name: 'Expand conversations' }).click()
        await page.waitForTimeout(700)
      }
      assert.deepEqual(await order(), before)
      assert.equal(await dot('buying-conversation-0').count(), 0)
      assert.equal(await dot('buying-conversation-7').count(), 1)
      await select('Messages', 'Selling')
      if (!mobile) {
        await card.getByRole('button', { name: 'Go Back', exact: true }).click()
        await page.waitForTimeout(700)
        assert.deepEqual(
          await card
            .locator('[data-conversation-id]')
            .evaluateAll((es) => es.map((e) => e.dataset.conversationId)),
          [
            'selling-conversation-5',
            'selling-conversation-0',
            'selling-conversation-13',
          ]
        )
        await card.getByRole('button', { name: 'Expand conversations' }).click()
        await page.waitForTimeout(700)
      }
      const selling = await order()
      assert.deepEqual(selling.slice(0, 3), [
        'selling-conversation-5',
        'selling-conversation-0',
        'selling-conversation-13',
      ])
      assert.equal(await dot('selling-conversation-0').count(), 1)
      await page.mouse.move(1, 1)
      await shot('selling-list-unread')
      await list
        .locator('[data-conversation-id="selling-conversation-0"]')
        .click()
      await page.waitForTimeout(400)
      await panel
        .getByRole('button', { name: 'View listing', exact: true })
        .click()
      await page.waitForTimeout(350)
      assert(
        await page
          .getByRole('dialog')
          .getByRole('button', { name: 'Send to buyer' })
          .isVisible()
      )
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
      await select('Messages', 'Buying')
      if (!mobile) {
        await card.getByRole('button', { name: 'Expand conversations' }).click()
        await page.waitForTimeout(700)
      }
      assert.deepEqual(await order(), before)
      assert.equal(await dot('buying-conversation-3').count(), 0)
      assert.equal(await dot('buying-conversation-7').count(), 1)
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        'sorted collection, shared avatar dots, identity-scoped read clearing, no click promotion, destination independence, listing association'
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
