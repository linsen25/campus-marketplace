/* global document, window, getComputedStyle */
const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { chromium } = require(process.env.PLAYWRIGHT_MODULE)

;(async () => {
  const output = path.join(process.env.TEMP, 'market-brand-checks')
  fs.mkdirSync(output, { recursive: true })
  const baselinePath = path.join(output, 'baseline.json')
  const baseline = fs.existsSync(baselinePath)
    ? JSON.parse(fs.readFileSync(baselinePath, 'utf8'))
    : null
  const browser = await chromium.launch({
    executablePath: process.env.BROWSER_EXECUTABLE,
    headless: true,
    args: ['--enable-unsafe-swiftshader'],
  })
  const results = {}
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        serviceWorkers: 'block',
      })
      const errors = [],
        writes = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.route(/https:\/\/fonts\.(googleapis|gstatic)\.com\//, (r) =>
        r.abort()
      )
      await page.route('**/api/**', (r) => {
        if (r.request().method() !== 'GET') writes.push(r.request().url())
        return r.fulfill({ json: [] })
      })
      await page.goto('http://localhost:3100/listings', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      })
      await page
        .getByRole('button', { name: 'Sort', exact: true })
        .waitFor({ state: 'visible' })
      await page.waitForTimeout(500)
      const visible = page.locator('[data-market-brand-mark]:visible')
      assert.equal(await visible.count(), 1, 'Exactly one visible brand mark')
      assert.equal((await visible.textContent()).trim(), '✦')
      assert.equal(
        await visible.locator('svg,img').count(),
        0,
        'Accepted literal glyph; no substitute asset'
      )
      assert.deepEqual(
        await page.locator('header [data-market-brand-mark]').allTextContents(),
        ['✦', '✦'],
        'Mobile and desktop use the shared component'
      )
      const brand = page.locator(
        width < 1024 ? 'header > div:first-child' : 'header h1'
      )
      assert.equal(
        (await brand.textContent()).replace(/\s+/g, ''),
        '✦CampusMarketplace'
      )
      assert(!(await brand.textContent()).includes('?'))
      const geometry = await brand.evaluate((el) => {
        const mark = el.querySelector('[data-market-brand-mark]')
        const s = getComputedStyle(mark)
        const rect = (node) => {
          const r = node.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }
        return {
          style: {
            fontFamily: s.fontFamily,
            fontSize: s.fontSize,
            fontWeight: s.fontWeight,
            lineHeight: s.lineHeight,
            color: s.color,
            opacity: s.opacity,
          },
          brand: rect(el),
          mark: rect(mark),
          header: rect(el.closest('header')),
          position: getComputedStyle(el.closest('header')).position,
        }
      })
      assert.deepEqual(
        geometry.style,
        results[390]?.style || {
          ...geometry.style,
          fontSize: '14px',
          fontWeight: '700',
          lineHeight: '20px',
          color: 'rgb(185, 160, 210)',
          opacity: '1',
        }
      )
      assert(
        Math.abs(
          geometry.mark.y +
            geometry.mark.height / 2 -
            geometry.brand.y -
            geometry.brand.height / 2
        ) < 0.1,
        'Mark is vertically centered'
      )
      assert.equal(geometry.position, 'sticky')
      const controls = await Promise.all(
        ['Sort', 'Filter'].map((name) =>
          page.getByRole('button', { name, exact: true }).boundingBox()
        )
      )
      const shot = await brand.screenshot({
        path: path.join(output, `${width}-after.png`),
      })
      if (baseline) {
        assert.deepEqual(
          geometry.header,
          baseline[width].header,
          'Header dimensions unchanged'
        )
        assert.deepEqual(
          controls,
          baseline[width].controls,
          'Sort/Filter positions and sizes unchanged'
        )
        if (width < 1024) {
          assert.deepEqual(geometry.style, baseline[width].style)
          assert.deepEqual(geometry.brand, baseline[width].brand)
          assert.equal(
            crypto.createHash('sha256').update(shot).digest('hex'),
            baseline[width].hash,
            'Mobile brand screenshot is pixel-identical'
          )
        }
      }
      await page.screenshot({ path: path.join(output, `${width}-header.png`) })
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await page.evaluate(() => window.scrollTo(0, 100))
      await page.waitForTimeout(250)
      assert.equal(
        await brand.evaluate(
          (el) => el.closest('header').getBoundingClientRect().x
        ),
        geometry.header.x
      )
      assert.equal(
        await brand.evaluate(
          (el) => el.closest('header').getBoundingClientRect().width
        ),
        geometry.header.width
      )
      assert.deepEqual(errors, [])
      assert.deepEqual(writes, [])
      results[width] = geometry
      console.log(
        `PASS ${width}: shared ✦, one visible mark, matching mobile treatment, centered/sticky header, no overflow, stable controls${
          width < 1024 && baseline ? ', pixel-identical mobile brand' : ''
        }`
      )
      await page.close()
    }
    fs.writeFileSync(
      path.join(output, 'results.json'),
      JSON.stringify(results, null, 2)
    )
  } finally {
    await browser.close()
  }
})().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
