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
            '/messages-refinement-' +
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
      const list = workspace.locator('[data-conversation-list]')
      if (mobile) {
        const tabs = workspace.getByRole('navigation', {
          name: 'Messages destination',
        })
        assert.equal(
          await tabs
            .getByRole('tab', { name: 'Buying' })
            .getAttribute('aria-selected'),
          'true'
        )
        assert.equal(await list.locator('button').count(), 18)
        assert.equal(await list.locator('[aria-pressed="true"]').count(), 0)
        assert.equal(await list.locator('.shining-button__arrow').count(), 18)
        assert.equal(
          await workspace.locator('[data-contacts-region]').count(),
          0
        )
        await page.mouse.move(1, 1)
        assert(
          await list
            .locator('button')
            .first()
            .evaluate(
              (el) =>
                getComputedStyle(el).backgroundColor === 'rgba(0, 0, 0, 0)'
            )
        )
        await shot('buying-list')
        await tabs.getByRole('tab', { name: 'Selling' }).click()
        await page.waitForTimeout(400)
        assert(
          (
            await list
              .locator('button')
              .first()
              .getAttribute('data-conversation-id')
          ).startsWith('selling-')
        )
        await page.mouse.move(1, 1)
        await shot('selling-list')
        await tabs.getByRole('tab', { name: 'Buying' }).click()
        await page.waitForTimeout(400)
        // The whole row supplies the same arrow hover/press feedback as View Listing.
        const row = list.locator('button').nth(3),
          arrow = row.locator('.shining-button__arrow')
        await row.hover()
        await page.waitForTimeout(750)
        assert.equal(
          await arrow.evaluate((el) => getComputedStyle(el).transform),
          'matrix(1.25, 0, 0, 1.25, 8, 0)'
        )
        await page.mouse.move(1, 1)
        await page.evaluate(() => {
          window.slideFrames = []
          const start = performance.now()
          const box = (el) => {
            const r = el.getBoundingClientRect()
            return [r.x, r.y, r.width, r.height]
          }
          function sample() {
            window.slideFrames.push({
              track: getComputedStyle(
                document.querySelector('[data-messages-track]')
              ).transform,
              header: box(document.querySelector('[data-home-mobile-header]')),
              nav: box(
                document.querySelector(
                  '[aria-label="Home and Market navigation"]'
                )
              ),
              viewport: box(document.querySelector('[data-messages-viewport]')),
            })
            if (performance.now() - start < 1400) requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        await row.click()
        await page.waitForTimeout(60)
        await shot('forward-mid')
        await page.waitForTimeout(350)
        await shot('chat')
        assert(await panel.isVisible())
        assert(!(await list.isVisible()))
        const forward = await page.evaluate(() => window.slideFrames)
        assert(
          forward.some((f) => {
            const x = Number(f.track.split(',')[4])
            return x < -10 && x > -300
          })
        )
        assert(
          forward.every(
            (f) =>
              JSON.stringify(f.header) === JSON.stringify(forward[0].header) &&
              JSON.stringify(f.nav) === JSON.stringify(forward[0].nav) &&
              JSON.stringify(f.viewport) === JSON.stringify(forward[0].viewport)
          )
        )
        console.log(
          'forward transforms',
          width,
          forward
            .map((f) => f.track)
            .filter((v, i, a) => i === 0 || v !== a[i - 1])
            .slice(0, 8)
        )
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
        await page.evaluate(() => {
          window.backFrames = []
          const start = performance.now()
          function sample() {
            const track = document.querySelector('[data-messages-track]')
            window.backFrames.push(
              Number(getComputedStyle(track).transform.split(',')[4])
            )
            if (performance.now() - start < 600) requestAnimationFrame(sample)
          }
          requestAnimationFrame(sample)
        })
        await workspace
          .getByRole('button', { name: 'Go Back', exact: true })
          .click()
        await page.waitForTimeout(60)
        await shot('back-mid')
        await page.waitForTimeout(350)
        const backFrames = await page.evaluate(() => window.backFrames)
        assert(backFrames.some((x) => x < -10 && x > -300))
        assert(backFrames[backFrames.length - 1] > -1)
        console.log('back transforms', width, backFrames.slice(0, 8))
        assert(await list.isVisible())
        assert(!(await panel.isVisible()))
        assert.equal(await list.locator('[aria-pressed="true"]').count(), 0)
        await page.mouse.move(1, 1)
        await shot('back-list')
        await list.locator('button').first().click()
        await page.waitForTimeout(350)
        await tabs.getByRole('tab', { name: 'Selling' }).click()
        await page.waitForTimeout(400)
        assert(await list.isVisible())
        assert(!(await panel.isVisible()))
        assert(
          (
            await list
              .locator('button')
              .first()
              .getAttribute('data-conversation-id')
          ).startsWith('selling-')
        )
        await list.locator('button').first().click()
        await page.waitForTimeout(350)
        await select('Messages', 'Buying')
        assert(await list.isVisible())
        assert(!(await panel.isVisible()))
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await list.locator('button').first().click()
        await page.waitForTimeout(100)
        assert.equal(
          await workspace.locator('[data-sliding="true"]').count(),
          0
        )
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
