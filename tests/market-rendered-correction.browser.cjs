/* global document, window, getComputedStyle, performance, requestAnimationFrame, scrollTo, scrollY, frames, panelFrames, panelStarted, started */
const assert = require('node:assert/strict')
const fs = require('node:fs')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)
;(async () => {
  const b = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const width of [390, 1280]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const cdp = await p.context().newCDPSession(p)
      const screenshot = async ({ path }) => {
        const result = await cdp.send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
          optimizeForSpeed: true,
        })
        fs.writeFileSync(path, Buffer.from(result.data, 'base64'))
      }
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route('**/api/auth/session', (r) =>
        r.fulfill({ json: { seller: null } })
      )
      await p.goto('http://localhost:3100/listings', {
        timeout: 120000,
        waitUntil: 'domcontentloaded',
      })
      await p.getByRole('button', { name: 'Filter', exact: true }).waitFor()
      await p.waitForTimeout(1800)
      const card = p
        .locator('[data-market-card] [data-slot="expandable-card"]')
        .first()
      const box = await card.boundingBox()
      await card.click()
      await p.getByRole('dialog').waitFor()
      await p.waitForTimeout(850)
      await p.evaluate(() => {
        window.frames = []
        window.started = performance.now()
        const sample = () => {
          const source = document.querySelector('[data-slot="expandable-card"]')
          const ret = document.querySelector('[data-slot="returning-media"]')
          const r = ret?.getBoundingClientRect()
          frames.push({
            t: performance.now() - started,
            source: getComputedStyle(source).visibility,
            ret: !!ret,
            opacity: ret ? getComputedStyle(ret).opacity : null,
            rect: r
              ? { x: r.x, y: r.y, width: r.width, height: r.height }
              : null,
          })
          if (performance.now() - started < 1500) requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
        Array.from(document.querySelectorAll('[role="dialog"] button'))
          .find((e) => e.textContent.trim() === 'Close')
          .click()
      })
      for (const [i, delay] of [50, 100, 150, 150, 150, 250].entries()) {
        await p.waitForTimeout(delay)
        await screenshot({
          path: `${process.env.TEMP}/market-correct-${width}-return-${i}.png`,
        })
      }
      await p.waitForFunction(
        () =>
          !document.querySelector('[data-slot="expandable-card"]').dataset
            .sourceHidden,
        { timeout: 4000 }
      )
      const f = await p.evaluate(() => frames)
      assert(f.some((f) => f.ret))
      assert(
        f
          .filter((f) => f.source === 'hidden')
          .every((f) => f.ret && f.opacity === '1'),
        'No hidden source without opaque returning media'
      )
      assert.deepEqual(await card.boundingBox(), box)
      console.log(
        width,
        'return',
        JSON.stringify(f.filter((_, i) => i % 8 === 0))
      )
      await card.click()
      await p.waitForTimeout(30)
      await p.keyboard.press('Escape')
      await p.waitForFunction(
        () =>
          !document.querySelector('[data-slot="expandable-card"]').dataset
            .sourceHidden
      )
      await p.emulateMedia({ reducedMotion: 'reduce' })
      await card.click()
      await p.keyboard.press('Escape')
      await p.waitForFunction(
        () =>
          !document.querySelector('[data-slot="expandable-card"]').dataset
            .sourceHidden
      )
      await p.emulateMedia({ reducedMotion: 'no-preference' })
      await p.waitForTimeout(450)
      for (const mode of ['Sort', 'Confirm', 'Cancel', 'backdrop', 'Escape']) {
        const label = mode === 'Sort' ? 'Sort' : 'Filter'
        await p.getByRole('button', { name: label, exact: true }).click()
        await p.waitForTimeout(800)
        const panel = p.getByRole('region', {
          name: label + ' options',
          exact: true,
        })
        const before = await panel.boundingBox()
        await panel.evaluate((e) => {
          window.panel = e
          window.panelFrames = []
          window.panelStarted = performance.now()
          const s = () => {
            if (e.isConnected) {
              const r = e.getBoundingClientRect()
              panelFrames.push({
                t: performance.now() - panelStarted,
                x: r.x,
                y: r.y,
                w: r.width,
                h: r.height,
                opacity: Number(getComputedStyle(e).opacity),
                rows: Array.from(e.querySelectorAll('button')).map(
                  (x) => x.getBoundingClientRect().y
                ),
              })
            }
            if (performance.now() - panelStarted < 500) requestAnimationFrame(s)
          }
          requestAnimationFrame(s)
        })
        if (mode === 'Sort')
          await p
            .getByRole('button', { name: 'Price: Low to High', exact: true })
            .click()
        else if (mode === 'Escape') await p.keyboard.press('Escape')
        else if (mode === 'backdrop')
          await p
            .locator('[data-market-focus-backdrop]')
            .click({ position: { x: 2, y: 400 } })
        else await p.getByRole('button', { name: mode, exact: true }).click()
        await p.waitForTimeout(mode === 'Sort' ? 220 : 70)
        await screenshot({
          path: `${process.env.TEMP}/market-correct-${width}-${mode}.png`,
        })
        await p.waitForTimeout(450)
        const samples = await p.evaluate(() => panelFrames)
        assert(samples.some((s) => s.opacity > 0 && s.opacity < 1))
        for (const s of samples) {
          assert(Math.abs(s.y - before.y) < 0.2)
          assert(Math.abs(s.h - before.height) < 0.2)
          assert.deepEqual(s.rows, samples[0].rows)
        }
        console.log('PASS', width, mode, 'stationary opacity fade')
      }
      if (width === 1280) {
        await p.evaluate(() => scrollTo(0, 501))
        await p.waitForTimeout(300)
        const top = p.getByRole('button', {
          name: 'Return to top',
          exact: true,
        })
        await top.waitFor()
        const rect = await top.boundingBox()
        assert.equal(rect.width, 50)
        assert.equal(rect.height, 50)
        assert.equal(rect.x, 1202)
        assert.equal(rect.y, 822)
        await screenshot({
          path: `${process.env.TEMP}/market-correct-top-1280.png`,
        })
        await top.click()
        await p.waitForTimeout(800)
        assert.equal(await p.evaluate(() => scrollY), 0)
        console.log(
          'PASS 1280 top visible501,50x50,right/bottom28,click returned0'
        )
      }
      assert.deepEqual(errors, [])
      await p.close()
    }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
