/* global window, document, getComputedStyle */
// Offline actual Shop Directory; layout-only regression, no hosted services.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const source = fs.readFileSync(
  'tests/shop-directory-controls.browser.cjs',
  'utf8'
)
const { root, build, aliases } = new Function(
  'require',
  source.slice(0, source.indexOf('async function main()')) +
    ';return {root,build,aliases}'
)(require)
async function main() {
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  const gridEvidence = []
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({
        viewport: { width, height: 1000 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (error) => errors.push(error.message))
      await p.route('**/*', (route) => {
        const url = new URL(route.request().url())
        assert.equal(
          url.origin,
          'http://localhost:4177',
          'no external services'
        )
        if (url.pathname === '/')
          return route.fulfill({
            path: path.join(root, 'index.html'),
            contentType: 'text/html',
          })
        if (url.pathname === '/bundle.js')
          return route.fulfill({
            path: path.join(root, 'bundle.js'),
            contentType: 'application/javascript',
          })
        if (url.pathname.startsWith('/static/'))
          return route.fulfill({
            path: path.resolve('public', '.' + url.pathname),
          })
        throw Error('Unexpected request ' + url.pathname)
      })
      await p.goto('http://localhost:4177/')
      const directory = p.locator('[data-shop-directory-content]')
      await directory.locator('[data-directory-shop]').first().waitFor()
      const grid = directory.locator('[data-all-shops-grid]')
      for (const image of await grid.locator('img').all()) {
        await image.evaluate((node) => {
          node.loading = 'eager'
          return node.decode()
        })
      }
      const layout = await grid.evaluate((node) => {
        const rect = (element) => {
          const r = element.getBoundingClientRect()
          return { x: r.x, y: r.y, width: r.width, height: r.height }
        }
        const css = getComputedStyle(node)
        return {
          display: css.display,
          columns: css.gridTemplateColumns.split(' ').length,
          gap: css.gap,
          grid: rect(node),
          parent: rect(node.parentElement),
          cards: Array.from(node.children).map((wrapper) => ({
            id: wrapper.dataset.directoryShop,
            wrapper: rect(wrapper),
            card: rect(wrapper.querySelector('[data-shop-card]')),
          })),
        }
      })
      const columns = width >= 1024 ? 4 : width >= 640 ? 2 : 1
      assert.equal(layout.display, 'grid')
      assert.equal(layout.columns, columns)
      assert.equal(layout.gap, '20px')
      assert.equal(layout.cards.length, 5)
      assert.equal(new Set(layout.cards.map((c) => c.id)).size, 5)
      assert(Math.abs(layout.grid.width - layout.parent.width) < 1)
      for (let i = 0; i < 5; i++) {
        const current = layout.cards[i]
        assert(Math.abs(current.card.width - current.wrapper.width) < 1)
        if (i < columns) {
          assert(Math.abs(current.card.y - layout.cards[0].card.y) < 1)
          if (i > 0)
            assert(
              current.card.x >=
                layout.cards[i - 1].card.x + layout.cards[i - 1].card.width + 19
            )
        } else {
          assert(
            current.card.y >=
              layout.cards[i - columns].card.y +
                layout.cards[i - columns].card.height +
                19
          )
          assert(
            Math.abs(current.card.x - layout.cards[i % columns].card.x) < 1
          )
        }
      }
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await p.evaluate(() => window.scrollTo(0, 0))
      await p.screenshot({
        fullPage: true,
        path: path.join(root, `all-shops-grid-${width}.png`),
      })
      gridEvidence.push({ width, ...layout })
      console.log(
        `PASS All Shops ${width}: ${columns} columns, five distinct cards, full content width, no overflow`
      )
      assert.deepEqual(errors, [])
      await p.close()
    }
    fs.writeFileSync(
      path.join(root, 'all-shops-grid-measurements.json'),
      JSON.stringify(gridEvidence, null, 2)
    )
  } finally {
    await browser.close()
  }
}
main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
