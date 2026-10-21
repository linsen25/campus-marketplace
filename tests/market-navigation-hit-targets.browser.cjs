/* global document, window, getComputedStyle */
// Run against an isolated offline Next app with empty local Supabase fixtures.
// No forced clicks, DOM/CSS overrides, logged-in state or remote requests.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ||
  './artifacts/browser-tools/node_modules/playwright-core')
const base = process.env.BASE_URL || 'http://127.0.0.1:3186'
assert(['localhost', '127.0.0.1'].includes(new URL(base).hostname))
const output = process.env.NAVIGATION_EVIDENCE_DIR || os.tmpdir()
const results = []

function tab(page, name) {
  return page
    .locator('[data-discover]')
    .getByRole('button', { name, exact: true })
}

async function hit(button) {
  return button.evaluate((element) => {
    const r = element.getBoundingClientRect()
    const target = document.elementFromPoint(
      r.x + r.width / 2,
      r.y + r.height / 2
    )
    const style = getComputedStyle(element)
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      intended: Boolean(target && element.contains(target)),
      interceptedBy: target?.closest('button')?.getAttribute('aria-label'),
      zIndex: style.zIndex,
    }
  })
}

async function controls(page) {
  const boxes = []
  for (const name of ['Resale', 'Shop', 'Sort', 'Filter']) {
    const button = ['Resale', 'Shop'].includes(name)
      ? tab(page, name)
      : page.getByRole('button', { name, exact: true })
    const box = await hit(button)
    assert(box.intended, `${name} must receive its pointer hit`)
    for (const previous of boxes) {
      const overlapX =
        Math.min(box.x + box.width, previous.x + previous.width) -
        Math.max(box.x, previous.x)
      const overlapY =
        Math.min(box.y + box.height, previous.y + previous.height) -
        Math.max(box.y, previous.y)
      assert(overlapX <= 0.5 || overlapY <= 0.5, `${name} must not overlap`)
    }
    boxes.push(box)
  }
}

async function panels(page) {
  for (const name of ['Filter', 'Sort']) {
    const button = page.getByRole('button', { name, exact: true })
    await button.click()
    const panel = page.getByRole('region', { name: `${name} options` })
    await panel.waitFor({ state: 'visible' })
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'detached' })
  }
}

async function main() {
  const browser = await chromium.launch({
    executablePath:
      process.env.BROWSER_EXECUTABLE ||
      'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  try {
    for (const motion of ['no-preference', 'reduce']) {
      for (const width of [390, 430, 820, 1280, 1536]) {
        const context = await browser.newContext({
          viewport: { width, height: 960 },
          reducedMotion: motion,
          serviceWorkers: 'block',
        })
        try {
          const page = await context.newPage()
          const errors = []
          const writes = []
          page.on('pageerror', (error) => errors.push(error.message))
          await context.route('**/*', (route) => {
            const request = route.request()
            if (new URL(request.url()).origin !== new URL(base).origin)
              return route.abort('blockedbyclient')
            if (!['GET', 'HEAD'].includes(request.method())) {
              writes.push(request.method())
              return route.abort('blockedbyclient')
            }
            return route.continue()
          })
          const response = await page.goto(`${base}/listings`, {
            waitUntil: 'domcontentloaded',
            timeout: 120000,
          })
          assert.equal(response.status(), 200)
          await page.locator('[data-market-ready="true"]').waitFor()
          await controls(page)
          const before = await hit(tab(page, 'Shop'))
          await panels(page)
          await tab(page, 'Shop').click()
          await page
            .getByText('No shops found in these categories.', { exact: true })
            .waitFor()
          assert.equal(
            await tab(page, 'Shop').getAttribute('aria-pressed'),
            'true'
          )
          await controls(page)
          await panels(page)
          await page.screenshot({
            path: path.join(output, `navigation-${width}-${motion}.png`),
          })
          await tab(page, 'Resale').click()
          assert.equal(
            await tab(page, 'Resale').getAttribute('aria-pressed'),
            'true'
          )
          await controls(page)
          await panels(page)
          assert(
            await page.evaluate(
              () =>
                document.documentElement.scrollWidth <= window.innerWidth + 1
            ),
            'No horizontal overflow'
          )
          assert.deepEqual(errors, [])
          assert.deepEqual(writes, [])
          results.push({ width, motion, shop: before, errors: 0, writes: 0 })
          fs.writeFileSync(
            path.join(output, 'navigation-results.json'),
            JSON.stringify(results, null, 2)
          )
          console.log(
            `PASS ${width} ${motion}: normal clicks, tabs, panels, hits`
          )
        } finally {
          await context.close()
        }
      }
    }
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
