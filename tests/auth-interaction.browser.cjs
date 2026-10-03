// Presentation/repeatability checks with a logged-out mocked session.
/* global document, getComputedStyle, performance, window, MutationObserver */
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright-core')
const assert = require('node:assert/strict')
const base = process.env.BASE_URL || 'http://localhost:3100'
const reduced = process.env.REDUCED_MOTION === '1'
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of (process.env.TEST_WIDTHS || '390,768,834,1280,1536')
      .split(',')
      .map(Number)) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
        reducedMotion: reduced ? 'reduce' : 'no-preference',
      })
      await page.route('**/api/auth/session', (route) =>
        route.fulfill({ json: { seller: null } })
      )
      await page.goto(base + '/', {
        waitUntil: 'domcontentloaded',
        timeout: 60000,
      })
      const before = page.url()
      const auth = page.locator('dialog[aria-labelledby="auth-title"]')
      await page.evaluate(() => {
        const seen = new WeakSet()
        const observer = new MutationObserver(() => {
          const dialog = document.querySelector(
            'dialog[aria-labelledby="auth-title"][open]'
          )
          if (dialog && !seen.has(dialog)) {
            seen.add(dialog)
            window.authEntranceOpacity = Number(
              getComputedStyle(dialog).opacity
            )
          }
        })
        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true,
        })
      })
      const dismiss = async (method) => {
        await auth.waitFor()
        assert.equal(page.url(), before)
        const entrance = await auth.evaluate((e) => ({
          opacity: Number(getComputedStyle(e).opacity),
          backdropDuration: getComputedStyle(e, '::backdrop').animationDuration,
          transform: getComputedStyle(e).transform,
        }))
        if (!reduced)
          assert(
            await page.evaluate(() => window.authEntranceOpacity < 1),
            'Entrance starts transparent'
          )
        assert.equal(entrance.backdropDuration, reduced ? '0s' : '0.22s')
        assert.equal(entrance.transform, 'none')
        await page.waitForFunction(() => {
          const dialog = document.querySelector(
            'dialog[aria-labelledby="auth-title"]'
          )
          return dialog && getComputedStyle(dialog).opacity === '1'
        })
        assert.equal(
          await auth.evaluate((e) => getComputedStyle(e).opacity),
          '1'
        )
        if (method === 'X')
          await auth
            .getByRole('button', { name: 'Close authentication' })
            .click()
        else if (method === 'Escape') await page.keyboard.press('Escape')
        else await page.mouse.click(2, 2)
        if (!reduced) {
          await auth.locator('xpath=self::*[@data-exiting]').waitFor()
          await page.waitForTimeout(50)
          assert(await auth.count(), 'Modal stays mounted through exit')
          const exit = await auth.evaluate((e) => ({
            opacity: Number(getComputedStyle(e).opacity),
            backdropDuration: getComputedStyle(e, '::backdrop')
              .animationDuration,
          }))
          assert(exit.opacity < 1 && exit.opacity > 0)
          assert.equal(exit.backdropDuration, '0.16s')
        }
        await auth.waitFor({ state: 'detached' })
        assert.equal(page.url(), before)
      }
      for (const method of ['X', 'Escape', 'backdrop']) {
        await page.getByRole('button', { name: 'Log in', exact: true }).click()
        await dismiss(method)
      }
      if (width < 1200) {
        const ticket = page.locator('.tear-ticket')
        const trigger = page.getByRole('button', {
          name: 'Tear ticket to log in',
        })
        for (const method of ['X', 'Escape', 'backdrop']) {
          // Keyboard tear uses the existing completed-tear lifecycle and consumes
          // the ticket, unlike a tap. Reset must re-enable this exact DOM node.
          await trigger.focus()
          await page.keyboard.press('Enter')
          await auth.waitFor()
          assert.equal(await ticket.getAttribute('data-used'), '')
          await dismiss(method)
          await page.waitForFunction(
            () =>
              !document.querySelector('.tear-ticket').hasAttribute('data-used')
          )
          assert.equal(await ticket.getAttribute('data-grabbing'), null)
          const original = await trigger.evaluate((e) => ({
            visibility: e.style.visibility,
            transform: getComputedStyle(e).transform,
            opacity: e.style.opacity,
            active: document.activeElement === e,
          }))
          assert.equal(original.visibility, '')
          assert.equal(Number(original.opacity), 1)
          assert.equal(original.transform, 'matrix(1, 0, 0, 1, 0, 0)')
          assert(original.active)
        }
        // Also exercise a real pointer tear through the existing simulation.
        const stub = await trigger.locator('.tear-ticket__stub').boundingBox()
        const start = {
          x: stub.x + stub.width * 0.25,
          y: stub.y + stub.height * 0.2,
        }
        await page.mouse.move(start.x, start.y)
        await page.mouse.down()
        await page.mouse.move(
          start.x + stub.width * 0.5,
          start.y + stub.height * 0.55,
          { steps: 12 }
        )
        await page.waitForTimeout(200)
        await page.mouse.up()
        await dismiss('Escape')
        await page.waitForFunction(
          () =>
            !document.querySelector('.tear-ticket').hasAttribute('data-used')
        )
        // A tap still opens without the Lanyard release delay.
        await trigger.locator('.tear-ticket__stub').click({ force: true })
        await dismiss('X')
      } else {
        const join = page.getByRole('button', {
          name: 'Join Campus Marketplace',
          exact: true,
        })
        await join.waitFor()
        for (const method of ['X', 'Escape', 'backdrop']) {
          await page.waitForTimeout(1500)
          const bounds = await join.boundingBox()
          let point
          // Raycast the actual existing mesh by its public hover cursor.
          for (
            let y = bounds.y + bounds.height * 0.3;
            y < bounds.y + bounds.height * 0.85 && !point;
            y += 22
          ) {
            for (
              let x = bounds.x + bounds.width * 0.3;
              x < bounds.x + bounds.width * 0.8;
              x += 22
            ) {
              await page.mouse.move(x, y)
              await page.waitForTimeout(20)
              if (
                await page.evaluate(() => document.body.style.cursor === 'grab')
              ) {
                await page.mouse.down()
                if ((await join.getAttribute('data-dragging')) !== null) {
                  point = { x, y }
                  break
                }
                await page.mouse.up()
              }
            }
          }
          assert(point, 'Actual Lanyard mesh is interactive')
          await page.mouse.move(point.x + 15, point.y + 45, { steps: 6 })
          assert.equal(await auth.count(), 0, 'No timer while pointer is held')
          await page.evaluate(() => {
            window.authRelease = 0
            window.authOpened = 0
            document.addEventListener(
              'pointerup',
              () => {
                window.authRelease = performance.now()
              },
              { once: true }
            )
            const observer = new MutationObserver(() => {
              if (
                document.querySelector(
                  'dialog[aria-labelledby="auth-title"][open]'
                )
              ) {
                window.authOpened = performance.now()
                observer.disconnect()
              }
            })
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
            })
          })
          await page.mouse.up()
          await auth.waitFor()
          const delay = await page.evaluate(
            () => window.authOpened - window.authRelease
          )
          assert(delay >= 190 && delay < 1000, `Release delay ${delay}ms`)
          await dismiss(method)
          assert(await join.evaluate((e) => document.activeElement === e))
          console.log(
            `PASS ${width} Lanyard ${method}: real drag/release delay ${Math.round(
              delay
            )}ms, re-armed`
          )
        }
      }
      await page.locator('[data-slot="expandable-card"]').click()
      const listing = page.getByRole('dialog').filter({
        has: page.getByRole('button', {
          name: 'Contact seller',
          exact: true,
        }),
      })
      for (const method of ['X', 'Escape', 'backdrop']) {
        await listing
          .getByRole('button', { name: 'Contact seller', exact: true })
          .click()
        await dismiss(method)
        assert(await listing.isVisible())
      }
      console.log(
        `PASS ${width}: ${
          reduced ? 'reduced motion' : 'shared entrance/exit fades'
        }, all dismissal methods, three join/reset cycles, unchanged URL`
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
