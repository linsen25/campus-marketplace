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
          process.env.TEMP + '/home-refinement-' + width + '-' + label + '.png'
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

      const mobileHeader = page
        .locator('header')
        .filter({ has: page.locator('[data-smooth-dropdown]') })
      for (const [group, child] of [
        ['Profile', 'Overview'],
        ['Profile', 'Analytics'],
        ['Messages', 'Buying'],
        ['Messages', 'Selling'],
        ['Listings', 'My Listings'],
        ['Listings', 'Favorites'],
      ]) {
        if (!mobile) {
          await select('Listings', 'Favorites')
          await shot('favorites')
          break
        }
        await select(
          group,
          mobile ? child : child === 'Overview' ? undefined : child
        )
        if (mobile) {
          const padding = await mobileHeader.evaluate((el) => ({
            top: parseFloat(getComputedStyle(el).paddingTop),
            bottom: parseFloat(getComputedStyle(el).paddingBottom),
          }))
          assert.equal(padding.top, 12)
          assert.equal(padding.bottom, 6)
          assert.equal(padding.bottom, padding.top / 2)
        }
        await shot(child.toLowerCase().replace(/ /g, '-'))
      }
      const favorites = page.getByRole('region', {
        name: 'Favorites',
        exact: true,
      })
      const buttons = favorites.locator('[data-market-controls] button')
      const sb = await buttons.nth(0).boundingBox(),
        fb = await buttons.nth(1).boundingBox()
      if (mobile) {
        assert.equal(sb.width, fb.width)
        assert(Math.abs(sb.y - fb.y) < 1)
        const groupBox = await favorites
          .locator('[data-market-controls]')
          .boundingBox()
        assert(Math.abs(groupBox.width - (sb.width + fb.width + 8)) < 1)
        for (const button of await buttons.all()) {
          const icon = await button.locator('svg').boundingBox(),
            text = await button.locator('span:visible').boundingBox()
          assert(icon.x + icon.width <= text.x)
        }
      }
      await buttons.nth(0).click()
      await page.waitForTimeout(300)
      assert(
        await page
          .getByRole('button', { name: 'Close filter or sort', exact: true })
          .isVisible()
      )
      await page
        .getByRole('button', { name: 'Close filter or sort', exact: true })
        .click({ position: { x: 5, y: 500 } })
      await page.waitForTimeout(350)
      await buttons.nth(1).click()
      await page.waitForTimeout(300)
      assert(
        await page
          .getByRole('button', { name: 'Close filter or sort', exact: true })
          .isVisible()
      )
      await page
        .getByRole('button', { name: 'Close filter or sort', exact: true })
        .click({ position: { x: 5, y: 500 } })
      await page.waitForTimeout(350)
      await select('Messages', 'Buying')
      const workspace = page.getByRole('region', {
        name: 'Messages',
        exact: true,
      })
      if (mobile) {
        await workspace.locator('[data-conversation-id]').first().click()
        await page.waitForTimeout(400)
      }
      const panel = workspace.getByRole('region', { name: 'Chat panel' }),
        header = panel.locator('header'),
        history = panel.locator('[data-message-history]')
      const headerBefore = await header.boundingBox()
      await history.evaluate((el) => (el.scrollTop = 100))
      const scrollBefore = await history.evaluate((el) => el.scrollTop)
      await shot('normal-chat')
      await panel
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      const layer = panel.locator('[data-attachment-panel]')
      const entering = await layer.evaluate(async (el) => {
        const out = []
        for (let i = 0; i < 8; i++) {
          await new Promise(requestAnimationFrame)
          out.push(new DOMMatrix(getComputedStyle(el).transform).m42)
        }
        return out
      })
      assert(entering.some((v) => v > 0))
      assert(entering.at(-1) < entering[0])
      const capture = async (label) => {
        const { data } = await screenshotSession.send(
          'Page.captureScreenshot',
          { format: 'png' }
        )
        require('node:fs').writeFileSync(
          process.env.TEMP + '/home-refinement-' + width + '-' + label + '.png',
          Buffer.from(data, 'base64')
        )
      }
      await capture('entering')
      await page.waitForTimeout(350)
      assert.equal(
        await layer.evaluate(
          (el) => new DOMMatrix(getComputedStyle(el).transform).m42
        ),
        0
      )
      assert.equal(
        await history.evaluate((el) => getComputedStyle(el).filter),
        'none'
      )
      assert.equal(await history.isVisible(), true)
      assert(
        await history.evaluate((el) => el.parentElement.hasAttribute('inert'))
      )
      const vp = await panel.locator('[data-chat-content]').boundingBox(),
        ab = await layer.boundingBox()
      assert.equal(ab.height, vp.height)
      assert.equal(ab.y, vp.y)
      assert.deepEqual(await header.boundingBox(), headerBefore)
      await shot('attachment-open')
      await layer
        .getByRole('button', { name: 'Add attachment', exact: true })
        .click()
      const exiting = await layer.evaluate(async (el) => {
        const out = []
        for (let i = 0; i < 8; i++) {
          await new Promise(requestAnimationFrame)
          out.push(new DOMMatrix(getComputedStyle(el).transform).m42)
        }
        return out
      })
      assert(exiting.at(-1) > exiting[0])
      await capture('exiting')
      await page.waitForTimeout(350)
      assert.equal(await layer.count(), 0)
      assert.equal(await history.isVisible(), true)
      assert.equal(await history.evaluate((el) => el.scrollTop), scrollBefore)
      assert.deepEqual(await header.boundingBox(), headerBefore)
      assert.deepEqual(errors, [])
      console.log(
        'PASS',
        width,
        'header 12/6, Favorites controls, attachment frames',
        entering,
        exiting
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exit(1)
})
