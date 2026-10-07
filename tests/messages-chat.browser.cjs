/* global window, requestAnimationFrame, Navigator, document, innerWidth, innerHeight, getComputedStyle */
const assert = require('node:assert/strict')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
  })
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
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
      await page.waitForTimeout(800)
      if (width >= 1024) await page.mouse.move(width - 10, 500)
      const workspace = page.getByRole('region', {
        name: 'Messages',
        exact: true,
      })
      const card = workspace.locator('[data-client-card]')
      const panel = workspace.getByRole('region', { name: 'Chat panel' })
      const input = panel.getByRole('textbox', { name: 'Message', exact: true })
      const send = panel.getByRole('button', { name: 'Send', exact: true })
      const listing = panel.getByRole('button', {
        name: 'View listing',
        exact: true,
      })
      const plus = panel.getByRole('button', { name: 'Add attachment' })

      const screenshot = (name) =>
        page.screenshot({
          path:
            process.env.TEMP +
            '/messages-coordinated-' +
            width +
            '-' +
            name +
            '.png',
        })
      await input.fill('Keep my draft')
      await page.evaluate(() => {
        window.originalChat = document.querySelector(
          '[aria-label="Chat panel"]'
        )
        window.originalInput = document.querySelector('[aria-label="Message"]')
        window.frames = []
        const sample = () => {
          const region = document.querySelector('[data-contacts-region]')
          const list = document.querySelector('[data-conversation-list]')
          const modal = document.querySelector(
            '[role="dialog"][aria-label="Listing preview"]'
          )
          window.frames.push({
            width: region?.getBoundingClientRect().width,
            innerWidth: list?.parentElement.offsetWidth,
            chatX: window.originalChat.getBoundingClientRect().x,
            opacity: modal ? Number(getComputedStyle(modal).opacity) : null,
            sameChat:
              window.originalChat ===
              document.querySelector('[aria-label="Chat panel"]'),
          })
          requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
      const initialBox = await panel.boundingBox()
      assert.equal(await card.locator('[data-conversation-id]').count(), 3)
      assert.equal(
        await card
          .getByRole('button', { name: 'Expand conversations' })
          .innerText(),
        '+15'
      )
      assert.equal(await plus.getAttribute('data-state'), 'idle')
      assert.equal(
        await plus.evaluate(
          (el) => getComputedStyle(el.firstElementChild).backgroundColor
        ),
        'rgb(0, 122, 255)'
      )
      assert.equal(
        await plus.evaluate(
          (el) => getComputedStyle(el.firstElementChild).boxShadow
        ),
        'none'
      )
      assert.equal(
        await send.evaluate(
          (el) => getComputedStyle(el.firstElementChild).backgroundColor
        ),
        'rgb(119, 84, 151)'
      )
      await plus.click()
      assert.equal(await plus.getAttribute('data-state'), 'idle')
      await screenshot('collapsed')
      await card.getByRole('button', { name: 'Expand conversations' }).click()
      await page.waitForTimeout(700)
      const list = card.locator('[data-conversation-list]')
      assert.equal(await list.locator('button').count(), 18)
      assert.equal(
        await card.locator('[data-expanded-contacts-grid]').count(),
        0
      )
      assert((await panel.boundingBox()).x > initialBox.x + 150)
      const expansion = await page.evaluate(() =>
        window.frames.filter((f) => f.innerWidth)
      )
      assert(expansion.every((f) => f.sameChat))
      assert(
        expansion.every((f) => f.innerWidth === (width < 1024 ? 280 : 320))
      )
      assert(
        expansion.some(
          (f) => f.width > 64 && f.width < (width < 1024 ? 279 : 319)
        )
      )
      await screenshot('expanded')
      const backY = (
        await card.getByRole('button', { name: 'Go Back' }).boundingBox()
      ).y
      await list.evaluate((el) => {
        el.scrollTop = el.scrollHeight
      })
      assert(await list.evaluate((el) => el.scrollTop > 0))
      assert.equal(
        (await card.getByRole('button', { name: 'Go Back' }).boundingBox()).y,
        backY
      )
      await screenshot('list-scrolled')
      await list
        .locator('[data-conversation-id="buying-conversation-15"]')
        .click()
      await page.waitForTimeout(700)
      assert.equal(await panel.locator('h3').innerText(), 'Cameron Scott')
      assert.equal(
        await card
          .locator('[data-conversation-id]')
          .first()
          .getAttribute('data-conversation-id'),
        'buying-conversation-15'
      )
      assert(Math.abs((await panel.boundingBox()).x - initialBox.x) < 1)
      assert.equal(await input.inputValue(), 'Keep my draft')
      await screenshot('selected')
      const preview = async (destination, title) => {
        if (width < 1024)
          await card.evaluate((el) => {
            el.scrollLeft = el.scrollWidth
          })
        await listing.click()
        await page.waitForTimeout(70)
        await screenshot(destination + '-opening')
        await page.waitForTimeout(400)
        const dialog = page.getByRole('dialog', { name: 'Listing preview' })
        assert.equal(await dialog.locator('h3').innerText(), title)
        assert.equal(
          await page.locator('[data-market-focus-backdrop]').count(),
          1
        )
        const blur = await page
          .locator('[data-market-focus-backdrop]')
          .evaluate((el) => getComputedStyle(el).backdropFilter)
        assert.equal(blur, 'blur(4px)')
        const box = await dialog.boundingBox()
        assert(
          box.x >= 15 &&
            box.y >= 15 &&
            box.x + box.width <= width - 15 &&
            box.y + box.height <= 885
        )
        assert(
          Math.abs(
            box.x +
              box.width / 2 -
              (await dialog.evaluate(
                (el) => el.parentElement.getBoundingClientRect().width
              )) /
                2
          ) < 1
        )
        if (width >= 1024) {
          const geometry = await dialog
            .locator('[data-listing-preview] > div')
            .first()
            .evaluate((el) => ({
              client: el.clientHeight,
              scroll: el.scrollHeight,
              overflow: getComputedStyle(el).overflowY,
              columns: getComputedStyle(el).gridTemplateColumns,
            }))
          assert(
            geometry.scroll <= geometry.client + 1,
            JSON.stringify(geometry)
          )
          assert.equal(geometry.overflow, 'visible')
          assert(geometry.columns.split(' ').length === 2)
        }
        const action = dialog.getByRole('button', {
          name: destination === 'selling' ? 'Send to buyer' : 'Send to seller',
        })
        await action.click()
        assert(await dialog.isVisible())
        await screenshot(destination + '-overlay')
        await dialog
          .getByRole('button', { name: 'Cancel', exact: true })
          .click()
        await page.waitForTimeout(70)
        await screenshot(destination + '-closing')
        await page.waitForTimeout(350)
        assert.equal(await page.getByRole('dialog').count(), 0)
        assert.equal(
          await page.locator('[data-market-focus-backdrop]').count(),
          0
        )
        assert.equal(await input.inputValue(), 'Keep my draft')
        assert(
          await page.evaluate(
            () =>
              window.originalChat ===
                document.querySelector('[aria-label="Chat panel"]') &&
              window.originalInput ===
                document.querySelector('[aria-label="Message"]')
          )
        )
        const opacityFrames = await page.evaluate(() =>
          window.frames.filter((f) => f.opacity !== null).map((f) => f.opacity)
        )
        assert(opacityFrames.some((n) => n > 0.1 && n < 0.9))
      }
      await preview('buying', 'AirPods Pro')
      await listing.click()
      await page.waitForTimeout(300)
      await page.keyboard.press('Escape')
      await page.waitForTimeout(350)
      assert.equal(await page.getByRole('dialog').count(), 0)
      await listing.click()
      await page.waitForTimeout(300)
      await page
        .getByRole('button', { name: 'Close listing preview' })
        .click({ position: { x: 2, y: 2 } })
      await page.waitForTimeout(350)
      assert.equal(await page.getByRole('dialog').count(), 0)
      if (width < 1024)
        await nav
          .getByRole('button', { name: 'Open Home navigation', exact: true })
          .click()
      else await nav.hover()
      await nav.getByRole('button', { name: 'Selling', exact: true }).click()
      if (width >= 1024) await page.mouse.move(width - 10, 500)
      await page.waitForTimeout(700)
      await preview('selling', 'Comfortable reading chair')
      assert.equal(await panel.locator('h3').innerText(), 'Alex Chen')
      assert.equal(
        await card
          .getByRole('button', { name: 'Expand conversations' })
          .innerText(),
        '+15'
      )
      const openNavigation = async () => {
        if (width < 1024) {
          const toggle = nav.getByRole('button', {
            name: 'Open Home navigation',
            exact: true,
          })
          if ((await toggle.getAttribute('aria-expanded')) === 'false')
            await toggle.click()
        } else await nav.hover()
      }
      await openNavigation()
      await nav.getByRole('button', { name: 'Buying', exact: true }).click()
      if (width >= 1024) await page.mouse.move(width - 10, 500)
      await page.waitForTimeout(700)
      assert.equal(await panel.locator('h3').innerText(), 'Cameron Scott')
      assert.equal(await input.inputValue(), 'Keep my draft')
      await card.getByRole('button', { name: 'Expand conversations' }).click()
      await page.waitForTimeout(700)
      await openNavigation()
      await nav
        .getByRole(width < 1024 ? 'button' : 'link', {
          name: 'Profile',
          exact: true,
        })
        .click()
      await page.waitForTimeout(700)
      assert.equal(await page.locator('[data-conversation-list]').count(), 0)
      assert.equal(await page.getByRole('dialog').count(), 0)
      assert.equal(errors.length, 0, errors.join('\n'))
      console.log(
        JSON.stringify({
          width,
          passed: true,
          conversationCount: 18,
          expandedWidth: width < 1024 ? 280 : 320,
          overlayNoScroll: width >= 1024,
          apiMethods: 'GET only',
        })
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
