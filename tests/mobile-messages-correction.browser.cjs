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
        await nav
          .getByRole(mobile ? 'button' : 'link', { name: group, exact: true })
          .click()
        if (child)
          await nav.getByRole('button', { name: child, exact: true }).click()
        if (!mobile) await page.mouse.move(width - 10, 500)
        await page.waitForTimeout(500)
      }
      const shot = async (label) =>
        page.screenshot({
          path:
            process.env.TEMP +
            '/mobile-correction-' +
            width +
            '-' +
            label +
            '.png',
        })
      if (mobile) {
        await select('Listings', 'My Listings')
        await shot('header-closed')
        const button = await toggle.boundingBox()
        assert.equal(button.x + button.width, width - 24)
        assert.deepEqual(
          await toggle
            .locator('path')
            .evaluateAll((es) => es.map((e) => e.getAttribute('d'))),
          ['M 4 6 L 20 6', 'M 4 12 L 20 12', 'M 4 18 L 20 18']
        )
        await page.evaluate(() => {
          window.iconFrames = []
          const start = performance.now()
          function sample() {
            const e = document.querySelector('[data-mobile-menu-icon]')
            window.iconFrames.push({
              d: e.querySelector('path').getAttribute('d'),
              transform: getComputedStyle(e).transform,
            })
            if (performance.now() - start < 600) requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        await toggle.click()
        await page.waitForTimeout(300)
        await shot('menu-open')
        const frames = await page.evaluate(() => window.iconFrames)
        assert(
          frames.some((f) => f.d !== 'M 4 6 L 20 6' && f.d !== 'M 4 12 L 12 4')
        )
        assert(frames.some((f) => f.transform !== 'none'))
        console.log(
          'icon intermediate',
          width,
          frames.find((f) => f.d !== 'M 4 6 L 20 6' && f.d !== 'M 4 12 L 12 4')
        )
        await toggle.click()
        await page.waitForTimeout(300)
      }
      await select('Messages', 'Buying')
      const workspace = page.getByRole('region', {
          name: 'Messages',
          exact: true,
        }),
        panel = workspace.getByRole('region', { name: 'Chat panel' }),
        list = workspace.locator('[data-conversation-list]')
      if (mobile) {
        assert.equal(await list.locator('button').count(), 18)
        assert(!(await panel.isVisible()))
        assert.equal(
          await workspace.locator('[data-contacts-region]').count(),
          0
        )
        await shot('list')
        await list.locator('button').nth(3).click()
        assert(await panel.isVisible())
        assert(!(await list.isVisible()))
        await shot('detail')
        const input = panel.getByRole('textbox', {
            name: 'Message',
            exact: true,
          }),
          plus = panel.getByRole('button', { name: 'Add attachment' }),
          send = panel.getByRole('button', { name: 'Send', exact: true })
        const a = await input.boundingBox(),
          b = await plus.boundingBox(),
          c = await send.boundingBox()
        assert(a.y + a.height <= b.y)
        assert.equal(a.x, b.x)
        assert(Math.abs(a.x + a.width - c.x - c.width) < 1)
        assert.equal(b.y + b.height / 2, c.y + c.height / 2)
        assert.equal(
          await plus.evaluate(
            (el) => getComputedStyle(el.firstElementChild).backgroundColor
          ),
          'rgb(0, 122, 255)'
        )
        assert.equal(
          await send.evaluate(
            (el) => getComputedStyle(el.firstElementChild).backgroundColor
          ),
          'rgb(119, 84, 151)'
        )
        await shot('composer')
        await panel
          .getByRole('button', { name: 'View listing', exact: true })
          .click()
        await page.waitForTimeout(350)
        const dialog = page.getByRole('dialog', { name: 'Listing preview' })
        assert.equal(await dialog.locator('h3').innerText(), 'AirPods Pro')
        assert(
          await dialog
            .getByRole('button', { name: 'Send to seller' })
            .isVisible()
        )
        await shot('preview')
        // Existing global navigation wins above the local portal when opened.
        await toggle.evaluate((el) => el.click())
        await page.waitForTimeout(300)
        assert(
          await nav
            .getByRole('button', { name: 'Messages', exact: true })
            .isVisible()
        )
        assert(
          await nav
            .getByRole('button', { name: 'Selling', exact: true })
            .evaluate((el) => {
              const r = el.getBoundingClientRect()
              return el.contains(
                document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
              )
            })
        )
        await shot('menu-above-preview')
        await nav.getByRole('button', { name: 'Selling', exact: true }).click()
        await page.waitForTimeout(500)
        assert(await list.isVisible())
        assert(!(await panel.isVisible()))
        assert.equal(await page.getByRole('dialog').count(), 0)
        assert(
          (
            await list
              .locator('button')
              .first()
              .getAttribute('data-conversation-id')
          ).startsWith('selling-')
        )
        await list.locator('button').first().click()
        await panel
          .getByRole('button', { name: 'View listing', exact: true })
          .click()
        await page.waitForTimeout(300)
        assert(
          await page
            .getByRole('dialog')
            .getByRole('button', { name: 'Send to buyer' })
            .isVisible()
        )
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
        await workspace
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        assert(await list.isVisible())
        assert(!(await panel.isVisible()))
        await list.locator('button').nth(2).click()
        await select('Messages', 'Buying')
        assert(await list.isVisible())
        assert(!(await panel.isVisible()))
      } else {
        const card = workspace.locator('[data-client-card]')
        assert.equal(await card.locator('[data-conversation-id]').count(), 3)
        assert.equal(
          await card
            .getByRole('button', { name: 'Expand conversations' })
            .innerText(),
          '+15'
        )
        await shot('desktop')
        const input = panel.getByRole('textbox', {
          name: 'Message',
          exact: true,
        })
        const a = await input.boundingBox(),
          b = await panel
            .getByRole('button', { name: 'Add attachment' })
            .boundingBox()
        assert(Math.abs(a.y - b.y) < 5)
        await card.getByRole('button', { name: 'Expand conversations' }).click()
        await page.waitForTimeout(700)
        assert.equal(await list.locator('button').count(), 18)
        await shot('desktop-expanded')
        await list.locator('button').nth(3).click()
        await page.waitForTimeout(700)
        assert(await panel.isVisible())
        await panel
          .getByRole('button', { name: 'View listing', exact: true })
          .click()
        await page.waitForTimeout(350)
        assert.equal(
          await page.getByRole('dialog').locator('h3').innerText(),
          'AirPods Pro'
        )
        await shot('desktop-preview')
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
      }
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        'mobile list/detail, composer, overlay, navigation / desktop rail regression'
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
