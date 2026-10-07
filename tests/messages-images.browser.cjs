const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    for (const width of process.env.MESSAGE_TEST_WIDTHS?.split(',').map(
      Number
    ) ?? [390, 430, 1280, 1536]) {
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
        await page.waitForTimeout(1800)
      }
      const screenshotSession = await page.context().newCDPSession(page)
      const shot = async (label) => {
        const path =
          process.env.TEMP + '/messages-images-' + width + '-' + label + '.png'
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

      await page
        .waitForSelector(
          mobile ? '[data-smooth-dropdown]' : '[data-slot=sidebar-body]',
          {
            timeout: 30000,
          }
        )
        .catch(async (e) => {
          console.log((await page.locator('body').innerText()).slice(0, 3000))
          throw e
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
        await page.waitForTimeout(1800)
      }
      const choose = async (id) => {
        await openList()
        await list.locator('[data-conversation-id="' + id + '"]').click()
        await page.waitForTimeout(1800)
      }
      await page.evaluate(() => {
        window.urlAudit = { created: [], revoked: [] }
        const create = URL.createObjectURL.bind(URL),
          revoke = URL.revokeObjectURL.bind(URL)
        URL.createObjectURL = (file) => {
          const url = create(file)
          window.urlAudit.created.push(url)
          return url
        }
        URL.revokeObjectURL = (url) => {
          window.urlAudit.revoked.push(url)
          revoke(url)
        }
      })
      await choose('buying-conversation-0')
      const file = (name = 'chair.jpg') => ({
        name,
        mimeType: 'image/jpeg',
        buffer: require('node:fs').readFileSync(
          'public/demo/reading-chair.jpg'
        ),
      })
      const mode = panel.getByRole('region', {
        name: 'Add attachment',
        exact: true,
      })
      const add = async () => {
        await panel
          .getByRole('button', { name: 'Add attachment', exact: true })
          .click()
        await page.waitForTimeout(360)
      }
      const pick = async (files) =>
        mode.locator('input[type="file"]').setInputFiles(files)
      const waitForExit = async () => {
        await mode
          .getByRole('button', { name: 'Add attachment', exact: true })
          .click()
        await page.waitForTimeout(360)
      }
      await shot('normal')
      await input.fill('Discard this unsent draft')
      await add()
      assert.equal(await input.isVisible(), false)
      assert(
        await mode
          .getByRole('button', { name: 'Send', exact: true })
          .isDisabled()
      )
      assert.equal(await rows.count(), 24)
      assert.equal(
        await history.evaluate((el) => getComputedStyle(el).filter),
        'none'
      )
      assert(
        await history.evaluate((el) => el.parentElement.hasAttribute('inert'))
      )
      assert.equal(
        await panel
          .locator('header')
          .evaluate((el) => getComputedStyle(el).filter),
        'none'
      )
      const box = await mode.boundingBox(),
        pbox = await panel.boundingBox(),
        hbox = await panel.locator('header').boundingBox()
      assert(box.y >= hbox.y + hbox.height - 1)
      assert(box.y + box.height <= pbox.y + pbox.height + 1)
      await shot('zero')
      for (const mimeType of ['application/pdf', 'text/plain', 'video/mp4']) {
        await pick([
          { name: 'invalid', mimeType, buffer: Buffer.from('invalid') },
        ])
        assert.match(await mode.getByRole('alert').innerText(), /JPEG/)
      }
      await pick([
        {
          name: 'big.png',
          mimeType: 'image/png',
          buffer: Buffer.alloc(3145729),
        },
      ])
      assert.match(await mode.getByRole('alert').innerText(), /3 MB/)
      await pick([file()])
      await shot('one-pending')
      await pick([file('two.jpg'), file('three.jpg'), file('four.jpg')])
      await shot('four-pending')
      const discardControl = mode.getByRole('button', {
        name: 'Discard',
        exact: true,
      })
      await discardControl.scrollIntoViewIfNeeded()
      await shot('four-pending-controls')
      await pick([file('five.jpg')])
      assert.match(await mode.getByRole('alert').innerText(), /at most 4/)
      await waitForExit()
      assert.equal(await input.inputValue(), '')
      assert.equal(
        await history.evaluate((el) => getComputedStyle(el).filter),
        'none'
      )
      assert.equal(await page.evaluate(() => window.urlAudit.revoked.length), 4)
      await add()
      await pick([file()])
      await mode.getByRole('button', { name: 'Discard', exact: true }).click()
      assert(
        await mode
          .getByRole('button', { name: 'Send', exact: true })
          .isDisabled()
      )
      assert(await mode.isVisible())
      await pick([file()])
      await mode
        .getByRole('button', { name: 'Send', exact: true })
        .evaluate((el) => {
          el.click()
          el.click()
        })
      // The image is already appended to the persistent underlay while the
      // attachment panel still owns loading/success feedback and exit.
      assert.equal(await rows.count(), 25)
      assert.equal(await rows.last().locator('img').count(), 1)
      assert.equal(await panel.locator('[data-attachment-panel]').count(), 1)
      await page.waitForTimeout(1800)
      assert.equal(await rows.count(), 25)
      assert.equal(await rows.last().locator('img').count(), 1)
      assert(
        await rows
          .last()
          .locator('img')
          .evaluate((el) => el.complete && el.naturalWidth > 0)
      )
      assert.equal(await rows.last().getAttribute('data-sent'), 'true')
      await shot('one-sent')
      await add()
      await pick([file(), file('two.jpg'), file('three.jpg'), file('four.jpg')])
      await mode.getByRole('button', { name: 'Send', exact: true }).click()
      await page.waitForTimeout(1800)
      assert.equal(await rows.count(), 26)
      const gallery = rows.last().locator('[data-image-gallery]')
      assert.equal(await gallery.locator('img').count(), 3)
      await shot('four-sent')
      await input.fill('Keep this composer draft while viewing photos')
      const scroll = await history.evaluate((el) => el.scrollTop)
      await gallery.getByRole('button', { name: 'See all 4 photos' }).click()
      await page.waitForTimeout(1800)
      assert.equal(await gallery.locator('img').count(), 4)
      await shot('expanded')
      await gallery.getByRole('button', { name: 'Go back to chat' }).click()
      await page.waitForTimeout(1800)
      console.log(
        'gallery scroll',
        scroll,
        await history.evaluate((el) => ({
          top: el.scrollTop,
          height: el.scrollHeight,
          client: el.clientHeight,
        }))
      )
      assert(
        Math.abs((await history.evaluate((el) => el.scrollTop)) - scroll) < 2
      )
      await shot('returned')
      assert.equal(
        await input.inputValue(),
        'Keep this composer draft while viewing photos'
      )
      for (const closeBy of ['escape', 'outside']) {
        await gallery.getByRole('button', { name: 'See all 4 photos' }).click()
        await page.waitForTimeout(700)
        if (closeBy === 'escape') await page.keyboard.press('Escape')
        else await panel.locator('header h3').click()
        await page.waitForTimeout(700)
        assert.equal(await gallery.getAttribute('data-expanded'), 'false')
        assert(
          Math.abs((await history.evaluate((el) => el.scrollTop)) - scroll) < 2
        )
      }
      await add()
      await pick([file(), file('two.jpg'), file('three.jpg'), file('four.jpg')])
      await mode.getByRole('button', { name: 'Next selected photo' }).click()
      await mode.getByRole('button', { name: 'Discard', exact: true }).click()
      await mode.getByRole('button', { name: 'Send', exact: true }).click()
      await page.waitForTimeout(1800)
      assert.equal(await rows.count(), 27)
      assert(
        await rows
          .last()
          .getByRole('button', { name: 'See all 3 photos' })
          .isVisible()
      )
      await openList()
      assert.match(
        await list
          .locator('[data-conversation-id="buying-conversation-0"]')
          .innerText(),
        /3 photos/
      )
      await choose('buying-conversation-0')
      await add()
      await pick([file()])
      await choose('buying-conversation-1')
      assert.equal(await mode.count(), 0)
      assert.equal(await rows.count(), 24)
      await choose('buying-conversation-0')
      assert.equal(await rows.count(), 27)
      assert.equal(await mode.count(), 0)
      assert(
        await rows
          .nth(24)
          .locator('img')
          .evaluate((el) => el.complete && el.naturalWidth > 0)
      )
      await select('Messages', 'Selling')
      if (mobile) await choose('selling-conversation-0')
      assert.equal(await rows.count(), 24)
      await page
        .waitForSelector(
          mobile ? '[data-smooth-dropdown]' : '[data-slot=sidebar-body]',
          {
            timeout: 30000,
          }
        )
        .catch(async (e) => {
          console.log((await page.locator('body').innerText()).slice(0, 3000))
          throw e
        })
      await select('Messages', 'Buying')
      await choose('buying-conversation-0')
      assert.equal(await rows.count(), 27)
      await add()
      await pick([file()])
      await waitForExit()
      await input.fill('Text after attachment cancel')
      await input.press('Enter')
      await page.waitForTimeout(1800)
      assert.equal(await rows.count(), 28)
      assert.equal(
        await rows.last().locator('p').innerText(),
        'Text after attachment cancel'
      )
      const alive = await page.evaluate(
        () =>
          window.urlAudit.created.filter(
            (url) => !window.urlAudit.revoked.includes(url)
          ).length
      )
      assert.equal(alive, 8)
      await select('Profile', mobile ? 'Overview' : undefined)
      await page.waitForTimeout(600)
      assert.equal(
        await page.evaluate(
          () =>
            window.urlAudit.created.filter(
              (url) => !window.urlAudit.revoked.includes(url)
            ).length
        ),
        0
      )
      assert.deepEqual(errors, [])
      console.log('PASS image attachments ' + width)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exit(1)
})
