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
      const screenshotSession = await page.context().newCDPSession(page)
      const shot = async (label) => {
        const path =
          process.env.TEMP + '/messages-send-' + width + '-' + label + '.png'
        if (label === 'loading' || label === 'sent-success') {
          // Capture the current rendered frame without screenshot stabilization
          // waiting past the intentionally brief button state.
          const { data } = await screenshotSession.send(
            'Page.captureScreenshot',
            { format: 'png' }
          )
          require('node:fs').writeFileSync(path, Buffer.from(data, 'base64'))
        } else await page.screenshot({ path })
      }

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
      const input = panel.getByRole('textbox', { name: 'Message', exact: true })
      const send = panel.getByRole('button', { name: 'Send', exact: true })
      const history = panel.locator('[data-message-history]')
      const rows = history.locator('[data-message-id]')
      const openList = async () => {
        if (mobile) {
          if (await panel.isVisible())
            await workspace
              .getByRole('button', { name: 'Go Back', exact: true })
              .click()
        } else {
          if (
            await card
              .getByRole('button', {
                name: 'Expand conversations',
                exact: true,
              })
              .isVisible()
          )
            await card
              .getByRole('button', {
                name: 'Expand conversations',
                exact: true,
              })
              .click()
        }
        await page.waitForTimeout(700)
      }
      const choose = async (id) => {
        await openList()
        await list.locator('[data-conversation-id="' + id + '"]').click()
        await page.waitForTimeout(700)
      }
      const order = () =>
        list
          .locator('[data-conversation-id]')
          .evaluateAll((es) => es.map((e) => e.dataset.conversationId))
      const snapshot = () =>
        list.locator('[data-conversation-id]').evaluateAll((es) =>
          es.map((e) => ({
            id: e.dataset.conversationId,
            text: e.querySelector('strong').parentElement.innerText,
            unread: !!e.querySelector('[data-conversation-unread]'),
          }))
        )
      await openList()
      const peersBefore = (await snapshot()).filter(
        (e) => e.id !== 'buying-conversation-0'
      )
      assert.notEqual((await order())[0], 'buying-conversation-0')
      await list
        .locator('[data-conversation-id="buying-conversation-0"]')
        .click()
      await page.waitForTimeout(700)
      await input.fill('unsent before switching')
      await choose('buying-conversation-3')
      assert.equal(await input.inputValue(), '')
      await choose('buying-conversation-0')
      assert.equal(await input.inputValue(), '')
      if (mobile) {
        await input.fill('unsent before Go Back')
        await choose('buying-conversation-0')
        assert.equal(await input.inputValue(), '')
      }
      await input.fill('discard on destination switch')
      await select('Messages', 'Selling')
      await openList()
      const sellingBefore = await snapshot()
      await list
        .locator('[data-conversation-id="selling-conversation-0"]')
        .click()
      await page.waitForTimeout(700)
      assert.equal(await input.inputValue(), '')
      await input.fill('discard on returning to Buying')
      await select('Messages', 'Buying')
      await choose('buying-conversation-0')
      assert.equal(await input.inputValue(), '')
      assert.equal(await rows.count(), 24)
      await history.evaluate((el) => {
        el.scrollTop = 0
      })
      assert(await send.isDisabled())
      await send.evaluate((el) => el.click())
      assert.equal(await rows.count(), 24)
      assert.equal(await history.evaluate((el) => el.scrollTop), 0)
      await input.fill('   ')
      assert(await send.isDisabled())
      await send.evaluate((el) => el.click())
      await input.press('Enter')
      assert.equal(await rows.count(), 24)
      assert.equal(await send.getAttribute('data-state'), 'idle')
      assert.equal(await history.evaluate((el) => el.scrollTop), 0)
      await openList()
      const invalidOrder = await order()
      assert.notEqual(invalidOrder[0], 'buying-conversation-0')
      await list
        .locator('[data-conversation-id="buying-conversation-0"]')
        .click()
      await page.waitForTimeout(700)
      const content =
        'Local pickup confirmation: I can come at 5. Please meet me near the library entrance.'
      await input.fill('  ' + content + '  ')
      assert.equal(await rows.count(), 24)
      await shot('before-send')
      const groupCount = await history.locator('[data-message-group]').count()
      await panel.evaluate((el) => {
        window.originalChat = el
      })
      await send.evaluate(async (el) => {
        window.sendStates = [el.dataset.state]
        new MutationObserver(() =>
          window.sendStates.push(el.dataset.state)
        ).observe(el, { attributes: true, attributeFilter: ['data-state'] })
        el.click()
        el.click()
        // React batches the click updates; observe the cleared controlled input
        // after that commit, then type again while the button is still loading.
        await new Promise((resolve) => requestAnimationFrame(resolve))
        const input = el
          .closest('[aria-label="Chat panel"]')
          .querySelector('textarea')
        window.draftAfterSend = input.value
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        ).set.call(input, 'New draft during feedback')
        input.dispatchEvent(new Event('input', { bubbles: true }))
      })
      assert.equal(await send.getAttribute('data-state'), 'loading')
      await shot('loading')
      assert.equal(await rows.count(), 25)
      assert.equal(await page.evaluate(() => window.draftAfterSend), '')
      assert.equal(await input.inputValue(), 'New draft during feedback')
      assert.equal(await rows.last().locator('p').innerText(), content)
      assert.equal(await rows.last().getAttribute('data-sent'), 'true')
      assert.equal(await rows.last().locator('[data-avatar-color]').count(), 0)
      assert.equal(
        await rows
          .last()
          .locator('p')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(0, 122, 255)'
      )
      assert.equal(
        await history.locator('[data-message-group]').count(),
        groupCount
      )
      assert.equal(
        await history.getAttribute('data-message-history'),
        'buying-conversation-0'
      )
      assert(await panel.evaluate((el) => el === window.originalChat))
      assert(await panel.isVisible())
      assert(
        await history.evaluate(
          (el) =>
            Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1
        )
      )
      await page.waitForTimeout(320)
      assert.equal(await send.getAttribute('data-state'), 'success')
      await shot('sent-success')
      assert.equal(await input.inputValue(), 'New draft during feedback')
      assert.equal(await rows.last().locator('p').innerText(), content)
      await input.fill('')
      await page.waitForTimeout(900)
      assert.equal(await send.getAttribute('data-state'), 'idle')
      assert(await send.isDisabled())
      const states = await page.evaluate(() => window.sendStates)
      assert(
        states.includes('loading') &&
          states.includes('success') &&
          states.includes('idle')
      )
      await shot('sent-bubble')
      if (!mobile) {
        assert.equal(
          await card
            .locator('[data-conversation-id]')
            .first()
            .getAttribute('data-conversation-id'),
          'buying-conversation-0'
        )
        assert.equal(
          await card
            .locator(
              '[data-conversation-id="buying-conversation-0"] [data-conversation-unread]'
            )
            .count(),
          0
        )
        assert.equal(
          await card
            .getByRole('button', { name: 'Expand conversations', exact: true })
            .innerText(),
          '+15'
        )
      }
      await openList()
      assert.equal((await order())[0], 'buying-conversation-0')
      assert(
        (
          await list
            .locator('[data-conversation-id="buying-conversation-0"]')
            .innerText()
        ).includes(content)
      )
      assert.equal(
        await list
          .locator(
            '[data-conversation-id="buying-conversation-0"] [data-conversation-unread]'
          )
          .count(),
        0
      )
      const peersAfter = (await snapshot()).filter(
        (e) => e.id !== 'buying-conversation-0'
      )
      // Conversation 3 was explicitly opened during draft checks, so its unread clears.
      assert.deepEqual(
        peersAfter,
        peersBefore.map((e) =>
          e.id === 'buying-conversation-3' ? { ...e, unread: false } : e
        )
      )
      if (mobile)
        assert.equal(await list.locator('[aria-pressed="true"]').count(), 0)
      await shot('reordered-list')
      await list
        .locator('[data-conversation-id="buying-conversation-0"]')
        .click()
      await page.waitForTimeout(700)
      assert.equal(await rows.count(), 25)
      assert.equal(await rows.last().locator('p').innerText(), content)
      assert.equal(await input.inputValue(), '')
      await choose('buying-conversation-3')
      assert.equal(await rows.count(), 24)
      assert.equal(await history.getByText(content, { exact: true }).count(), 0)
      await select('Messages', 'Selling')
      await openList()
      assert.deepEqual(
        await snapshot(),
        sellingBefore.map((e) =>
          e.id === 'selling-conversation-0' ? { ...e, unread: false } : e
        )
      )
      await list
        .locator('[data-conversation-id="selling-conversation-0"]')
        .click()
      await page.waitForTimeout(700)
      assert.equal(await rows.count(), 24)
      await input.fill('Selling-only local message')
      await send.click()
      await page.waitForTimeout(1100)
      assert.equal(await rows.count(), 25)
      assert.equal(
        await rows.last().locator('p').innerText(),
        'Selling-only local message'
      )
      await select('Messages', 'Buying')
      await choose('buying-conversation-0')
      assert.equal(await rows.count(), 25)
      assert.equal(await rows.last().locator('p').innerText(), content)
      await input.fill('discard when leaving Messages')
      await select('Settings')
      await select('Messages', 'Buying')
      await choose('buying-conversation-0')
      assert.equal(await input.inputValue(), '')
      assert.equal(await rows.count(), 24)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(1200)
      await select('Messages', 'Buying')
      await choose('buying-conversation-0')
      assert.equal(await rows.count(), 24)
      assert.equal(await input.inputValue(), '')
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        'valid/invalid click Send, captured trimmed content, loading-success-idle, duplicate prevention, no remount, bottom scroll, activity order/preview, unread/collection/history isolation, sent history retention, draft discard, refresh reset'
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
