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
            '/messages-bubbles-' +
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
      const panel = workspace.getByRole('region', { name: 'Chat panel' })
      const card = workspace.locator(
        mobile ? '[data-mobile-messages]' : '[data-client-card]'
      )
      const list = workspace.locator('[data-conversation-list]')
      const choose = async (id) => {
        if (mobile) {
          if (await panel.isVisible()) {
            await workspace
              .getByRole('button', { name: 'Go Back', exact: true })
              .click()
            await page.waitForTimeout(400)
          }
        } else {
          await card
            .getByRole('button', { name: 'Expand conversations', exact: true })
            .click()
          await page.waitForTimeout(700)
        }
        await list.locator('[data-conversation-id="' + id + '"]').click()
        await page.waitForTimeout(700)
      }
      await choose('buying-conversation-3')
      const history = panel.locator('[data-message-history]')
      const rows = history.locator('[data-message-id]')
      assert.equal(
        await history.getAttribute('data-message-history'),
        'buying-conversation-3'
      )
      assert.equal(await rows.count(), 24)
      const ids = await rows.evaluateAll((es) =>
        es.map((e) => e.dataset.messageId)
      )
      assert(ids.every((id) => id.startsWith('buying-conversation-3-message-')))
      const sent = rows
        .filter({ has: page.locator('[class*="bubble"]') })
        .locator('p')
      const incoming = history.locator('[data-sent="false"]')
      const outgoing = history.locator('[data-sent="true"]')
      assert.equal(await incoming.count(), 12)
      assert.equal(await incoming.locator('[data-avatar-color]').count(), 12)
      assert.equal(await outgoing.locator('[data-avatar-color]').count(), 0)
      assert.equal(
        await history.locator('[data-conversation-unread]').count(),
        0
      )
      assert.equal(
        await incoming
          .locator('[data-avatar-color]')
          .first()
          .getAttribute('data-avatar-color'),
        '#664780'
      )
      const surface = panel
        .getByRole('button', { name: 'Send', exact: true })
        .locator('[class*="surface"]')
        .first()
      const color = await surface.evaluate(
        (el) => getComputedStyle(el).backgroundColor
      )
      assert.equal(color, 'rgb(119, 84, 151)')
      assert.equal(
        await incoming
          .locator('p')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        color
      )
      assert.equal(
        await outgoing
          .locator('p')
          .first()
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(0, 122, 255)'
      )
      assert.equal(
        await sent.first().evaluate((el) => getComputedStyle(el).color),
        'rgb(255, 255, 255)'
      )
      assert.equal(
        await sent.first().evaluate((el) => getComputedStyle(el).maxWidth),
        mobile ? '82%' : '65%'
      )
      const groups = history.locator('[data-message-group]')
      assert.equal(await groups.count(), 12)
      assert.equal(await history.locator('time').count(), 12)
      assert.equal(await groups.nth(0).locator('[data-message-id]').count(), 3)
      assert.equal(await groups.nth(1).locator('[data-message-id]').count(), 3)
      assert.equal(await groups.nth(0).locator('time').count(), 1)
      assert(await history.evaluate((el) => el.scrollHeight > el.clientHeight))
      assert(
        await history.evaluate(
          (el) =>
            Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1
        )
      )
      const header = panel.locator('header')
      const input = panel.getByRole('textbox', { name: 'Message', exact: true })
      const headerBefore = await header.boundingBox(),
        composerBefore = await input.boundingBox()
      await shot('buying-latest')
      await history.evaluate((el) => {
        el.scrollTop = 0
      })
      await page.waitForTimeout(100)
      const firstSent = await outgoing.first().boundingBox(),
        firstReceived = await incoming.first().boundingBox()
      const firstSentBubble = await outgoing.first().locator('p').boundingBox(),
        firstReceivedBubble = await incoming.first().locator('p').boundingBox()
      assert(
        Math.abs(
          firstSentBubble.x +
            firstSentBubble.width -
            (firstSent.x + firstSent.width)
        ) < 1
      )
      assert(Math.abs(firstReceivedBubble.x - firstReceived.x - 40) < 1)
      const secondReceived = await incoming.nth(1).boundingBox()
      assert(
        Math.abs(
          secondReceived.y - firstReceived.y - firstReceived.height - 4
        ) < 1
      )
      assert.deepEqual(await header.boundingBox(), headerBefore)
      assert.deepEqual(await input.boundingBox(), composerBefore)
      await shot('buying-top-groups')
      await history
        .locator('[data-message-id="buying-conversation-3-message-13"]')
        .scrollIntoViewIfNeeded()
      const longBubble = history.locator(
        '[data-message-id="buying-conversation-3-message-13"] p'
      )
      assert(
        await longBubble.evaluate(
          (el) => el.clientHeight > 65 && el.scrollWidth <= el.clientWidth
        )
      )
      assert(await history.evaluate((el) => el.scrollWidth <= el.clientWidth))
      await shot('buying-long-wrap')
      await input.fill('Unsent draft used only to verify conversation switching')
      assert.equal(await rows.count(), 24)
      await choose('buying-conversation-0')
      assert.equal(
        await history.getAttribute('data-message-history'),
        'buying-conversation-0'
      )
      assert.equal(
        await history
          .locator('[data-message-id="buying-conversation-3-message-13"]')
          .count(),
        0
      )
      assert(
        (await rows.first().innerText()).includes('Comfortable reading chair')
      )
      assert(
        await history.evaluate(
          (el) =>
            Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1
        )
      )
      await select('Messages', 'Selling')
      await choose('selling-conversation-0')
      assert.equal(
        await history.getAttribute('data-message-history'),
        'selling-conversation-0'
      )
      assert(
        (await rows.first().innerText()).includes('Comfortable reading chair')
      )
      assert.equal(await rows.count(), 24)
      assert(
        await history.evaluate(
          (el) =>
            Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1
        )
      )
      await shot('selling-latest')
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        'visible bubbles, exact colors, per-message avatars, sender groups/timestamps, wrapping, fixed header/composer, bottom-on-switch, isolated histories'
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
