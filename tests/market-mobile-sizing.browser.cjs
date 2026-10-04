/* global window, document, getComputedStyle */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 900 },
      serviceWorkers: 'block',
    })
    await page.route('**/api/auth/session', (r) =>
      r.fulfill({ json: { seller: null } })
    )
    await page.goto('http://localhost:3100/listings', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    })
    await page.getByRole('button', { name: 'Filter', exact: true }).waitFor()
    await page.waitForTimeout(1500)
    const cdp = await page.context().newCDPSession(page)
    const capture = async (name) => {
      const r = await cdp.send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      })
      fs.writeFileSync(
        `${process.env.TEMP}/market-mobile-sizing-${name}.png`,
        Buffer.from(r.data, 'base64')
      )
    }
    const card = page.locator('[data-slot="expandable-card"]').first()
    const collapsed = await card.boundingBox()
    await card.click()
    await page.getByRole('dialog').waitFor()
    await page.waitForTimeout(850)
    const descriptions = {
      short: 'Ready for pickup.',
      medium:
        'A well-kept laptop ready for another Western student. Includes the charger, and pickup is available on campus this week.',
      long: 'A well-kept laptop ready for another Western student. Includes the charger, and pickup is available on campus this week. '.repeat(
        20
      ),
    }
    let natural = {}
    for (const height of [900, 844, 700]) {
      await page.setViewportSize({ width: 390, height })
      await page.waitForTimeout(150)
      for (const [name, text] of Object.entries(descriptions)) {
        const state = await page.getByRole('dialog').evaluate((e, text) => {
          const description = Array.from(e.querySelectorAll('h4')).find(
            (x) => x.textContent === 'Description'
          ).nextElementSibling
          description.textContent = text
          const area = e.querySelector('[data-slot="expanded-price"]')
            .parentElement.parentElement
          area.scrollTop = 0
          const rect = e.getBoundingClientRect()
          const image = e.querySelector('img').getBoundingClientRect()
          const price = e
            .querySelector('[data-slot="expanded-price"]')
            .getBoundingClientRect()
          const actions = e.lastElementChild.getBoundingClientRect()
          return {
            height: rect.height,
            top: rect.top,
            bottom: rect.bottom,
            max: parseFloat(getComputedStyle(e).maxHeight),
            bodyClient: area.clientHeight,
            bodyScroll: area.scrollHeight,
            imageWidth: image.width,
            imageHeight: image.height,
            priceTop: price.top,
            imageBottom: image.bottom,
            actionsBottom: actions.bottom,
            actionsTop: actions.top,
            scrollTop: area.scrollTop,
          }
        }, text)
        assert.equal(state.max, height - 16)
        assert(state.top >= 7.9 && state.bottom <= height - 7.9)
        assert.equal(state.imageWidth / state.imageHeight, 4 / 3)
        assert(state.priceTop >= state.imageBottom + 23)
        assert(state.actionsBottom <= state.bottom - 15)
        if (height === 900 && name !== 'long') {
          natural[name] = state.height
          assert(state.height < state.max)
          assert(
            state.bodyScroll - state.bodyClient <= 1,
            'Fitting natural content does not scroll'
          )
        } else if (name === 'long' || natural[name] > height - 16) {
          assert(Math.abs(state.height - state.max) < 0.1)
          assert(state.bodyScroll > state.bodyClient)
          const scrolled = await page.getByRole('dialog').evaluate((e) => {
            const area = e.querySelector('[data-slot="expanded-price"]')
              .parentElement.parentElement
            area.scrollTop = 80
            return area.scrollTop
          })
          assert(scrolled > 0)
          await page
            .getByRole('dialog')
            .evaluate(
              (e) =>
                (e.querySelector(
                  '[data-slot="expanded-price"]'
                ).parentElement.parentElement.scrollTop = 0)
            )
        } else {
          assert.equal(state.height, natural[name])
          assert(state.bodyScroll - state.bodyClient <= 1)
        }
        await capture(`${height}-${name}`)
        console.log('PASS 390x' + height, name, JSON.stringify(state))
      }
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await page
      .getByRole('dialog')
      .getByRole('button', { name: 'Close', exact: true })
      .click()
    await page.waitForFunction(
      () =>
        !document.querySelector('[data-slot="expandable-card"]').dataset
          .sourceHidden
    )
    assert.deepEqual(
      await card.boundingBox(),
      collapsed,
      'Collapsed cards unchanged'
    )
    assert.equal(
      await card
        .locator('img')
        .evaluate(
          (e) => getComputedStyle(e.parentElement.parentElement).transform
        ),
      'none'
    )
    for (const width of [1280, 1536]) {
      await page.setViewportSize({ width, height: 900 })
      await page.waitForTimeout(500)
      await card.click()
      await page.waitForTimeout(850)
      const state = await page
        .getByRole('dialog')
        .evaluate((e) => ({
          dialog: e.getBoundingClientRect().toJSON(),
          image: e.querySelector('img').getBoundingClientRect().toJSON(),
          price: e
            .querySelector('[data-slot="expanded-price"]')
            .getBoundingClientRect()
            .toJSON(),
        }))
      assert.equal(state.dialog.width, 1040)
      assert.equal(state.dialog.height, 753.5)
      assert.equal(state.image.width, 470)
      assert.equal(state.image.height, 587.5)
      assert.equal(state.price.y, 138.25)
      await capture('desktop-' + width)
      await page.keyboard.press('Escape')
      await page.waitForFunction(
        () =>
          !document.querySelector('[data-slot="expandable-card"]').dataset
            .sourceHidden
      )
      console.log('PASS', width, 'desktop sizing unchanged')
    }
    await page.close()
  } finally {
    await browser.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
