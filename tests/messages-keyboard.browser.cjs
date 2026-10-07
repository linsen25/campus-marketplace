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
          process.env.TEMP +
          '/messages-keyboard-' +
          width +
          '-' +
          label +
          '.png'
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
        } else if (
          await card
            .getByRole('button', { name: 'Expand conversations', exact: true })
            .isVisible()
        ) {
          await card
            .getByRole('button', { name: 'Expand conversations', exact: true })
            .click()
        }
        await page.waitForTimeout(700)
      }
      const choose = async (id) => {
        await openList()
        await list.locator('[data-conversation-id="' + id + '"]').click()
        await page.waitForTimeout(700)
      }
      await choose('buying-conversation-0')
      assert.equal(await input.evaluate((el) => el.tagName), 'TEXTAREA')
      assert.equal((await input.boundingBox()).height, 40)
      assert(!(await input.isDisabled()))
      const beforeBox = await input.boundingBox()
      const attachmentBox = await panel
        .getByRole('button', { name: 'Add attachment' })
        .boundingBox()
      const sendBox = await send.boundingBox()
      if (mobile) {
        assert(sendBox.y > beforeBox.y + beforeBox.height)
        assert(Math.abs(sendBox.y - attachmentBox.y) < 5)
        assert(sendBox.x > attachmentBox.x)
      } else assert(Math.abs(beforeBox.y - attachmentBox.y) < 5)
      await history.evaluate((el) => {
        el.scrollTop = 0
      })
      await input.press('Enter')
      await input.fill(' \n \n ')
      await input.press('Enter')
      assert.equal(await rows.count(), 24)
      assert.equal(await send.getAttribute('data-state'), 'idle')
      assert.equal(await history.evaluate((el) => el.scrollTop), 0)
      await input.fill('Hello')
      await input.press('Enter')
      assert.equal(await rows.count(), 25)
      assert.equal(await rows.last().locator('p').innerText(), 'Hello')
      assert.equal(await input.inputValue(), '')
      assert.equal(await rows.last().getAttribute('data-sent'), 'true')
      assert.equal(
        await rows
          .last()
          .locator('p')
          .evaluate((el) => getComputedStyle(el).backgroundColor),
        'rgb(0, 122, 255)'
      )
      assert(
        await history.evaluate(
          (el) =>
            Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) <= 1
        )
      )
      await page.waitForTimeout(1100)
      await openList()
      assert.equal(
        await list
          .locator('[data-conversation-id]')
          .first()
          .getAttribute('data-conversation-id'),
        'buying-conversation-0'
      )
      const row = list.locator('[data-conversation-id="buying-conversation-0"]')
      assert.equal(await row.locator('small').innerText(), 'Hello')
      assert.equal(await row.locator('[data-conversation-unread]').count(), 0)
      await row.click()
      await page.waitForTimeout(700)
      // Guard both native composing flag and tracked composition events.
      await input.fill('你好')
      await input.evaluate((el) =>
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            isComposing: true,
          })
        )
      )
      assert.equal(await rows.count(), 25)
      await input.evaluate((el) => {
        el.dispatchEvent(
          new CompositionEvent('compositionstart', { bubbles: true })
        )
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            isComposing: false,
          })
        )
      })
      assert.equal(await rows.count(), 25)
      assert.equal(await input.inputValue(), '你好')
      assert.equal(await send.getAttribute('data-state'), 'idle')
      await input.evaluate((el) =>
        el.dispatchEvent(
          new CompositionEvent('compositionend', {
            bubbles: true,
            data: '你好',
          })
        )
      )
      await input.press('Enter')
      assert.equal(await rows.count(), 26)
      assert.equal(await rows.last().locator('p').innerText(), '你好')
      await page.waitForTimeout(1100)
      await input.fill('Hi,')
      await input.press('Shift+Enter')
      await input.pressSequentially('I can meet at 5.')
      await input.press('Shift+Enter')
      await input.pressSequentially('Does that work?')
      const multiline = 'Hi,\nI can meet at 5.\nDoes that work?'
      assert.equal(await input.inputValue(), multiline)
      assert.equal(await rows.count(), 26)
      assert.deepEqual(await input.boundingBox(), beforeBox)
      await shot('multiline-draft')
      await send.click()
      assert.equal(await rows.count(), 27)
      const bubble = rows.last().locator('p')
      assert.equal(await bubble.textContent(), multiline)
      assert.equal(
        await bubble.evaluate((el) => getComputedStyle(el).whiteSpace),
        'pre-wrap'
      )
      assert.equal(
        await bubble.evaluate((el) => getComputedStyle(el).maxWidth),
        mobile ? '82%' : '65%'
      )
      assert((await bubble.boundingBox()).height > 65)
      assert(await history.evaluate((el) => el.scrollWidth <= el.clientWidth))
      await page.waitForTimeout(1100)
      await shot('multiline-bubble')
      await openList()
      const preview = row.locator('small')
      assert.equal(
        await preview.evaluate((el) => getComputedStyle(el).whiteSpace),
        'nowrap'
      )
      assert.equal(
        await preview.evaluate((el) => getComputedStyle(el).textOverflow),
        'ellipsis'
      )
      assert((await preview.boundingBox()).height < 20)
      await row.click()
      await page.waitForTimeout(700)
      // Enter -> click and repeated Enter all use the button's same pending guard.
      await input.fill('First')
      await input.evaluate(async (el) => {
        const button = el.parentElement.querySelector('[data-chat-send]')
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          })
        )
        button.click()
        await new Promise((resolve) => requestAnimationFrame(resolve))
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        ).set.call(el, 'Second')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          })
        )
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          })
        )
        button.click()
      })
      assert.equal(await send.getAttribute('data-state'), 'loading')
      assert.equal(await rows.count(), 28)
      assert.equal(await rows.last().locator('p').innerText(), 'First')
      assert.equal(await input.inputValue(), 'Second')
      assert(!(await input.isDisabled()))
      await page.waitForTimeout(400)
      assert.equal(await send.getAttribute('data-state'), 'success')
      assert.equal(await input.inputValue(), 'Second')
      // StatefulButton releases pending at success: both click and Enter can send again.
      await input.press('Enter')
      assert.equal(await rows.count(), 29)
      assert.equal(await rows.last().locator('p').innerText(), 'Second')
      assert.equal(await input.inputValue(), '')
      await page.waitForTimeout(1100)
      // Reverse: click -> Enter, with a next draft typed while loading.
      await input.fill('Third')
      await send.evaluate(async (button) => {
        const el = button.parentElement.querySelector('textarea')
        button.click()
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          })
        )
        await new Promise((resolve) => requestAnimationFrame(resolve))
        Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          'value'
        ).set.call(el, 'Fourth unsent')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        el.dispatchEvent(
          new KeyboardEvent('keydown', {
            key: 'Enter',
            bubbles: true,
            cancelable: true,
          })
        )
      })
      assert.equal(await rows.count(), 30)
      assert.equal(await rows.last().locator('p').innerText(), 'Third')
      assert.equal(await input.inputValue(), 'Fourth unsent')
      await choose('buying-conversation-3')
      assert.equal(await input.inputValue(), '')
      assert.equal(await rows.count(), 24)
      await choose('buying-conversation-0')
      assert.equal(await rows.count(), 30)
      assert.equal(await input.inputValue(), '')
      assert.equal(
        await history.getByText('Fourth unsent', { exact: true }).count(),
        0
      )
      assert.equal(await history.locator('[data-message-group]').count(), 12)
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        'Enter/click shared send+pending boundary, Shift+Enter native newline, multiline bubble/one-line preview, native/tracked IME guard, editable Second preserved during loading/success, cross-input duplicate guard, sorting/unread/scroll, draft discard, fixed composer geometry'
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
