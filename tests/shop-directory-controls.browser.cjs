/* global window, document */
// Shop Directory UI only, intercepted local assets; no API or hosted data.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  ts = require('typescript')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'shop-directory-link.jsx'),
  'export const Link=props=><a {...props}/>'
)
aliases['@ui/link/link'] = path.join(root, 'shop-directory-link.jsx')
// Additional ties exercise all three comparator levels, beyond the current demo values.
const domain = { exports: {} }
new Function(
  'exports',
  ts.transpileModule(fs.readFileSync('lib/shop-directory.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS },
  }).outputText
)(domain.exports)
const { browseShops, SHOP_CATEGORIES } = domain.exports
const tied = [
  ['a', 4.9, 10, 20],
  ['b', 4.9, 11, 20],
  ['c', 4.9, 11, 25],
  ['d', 4.8, 30, 25],
].map(([id, rating, reviews, sold]) => ({
  id,
  category: SHOP_CATEGORIES[0],
  figures: { rating: String(rating), reviews, sold },
}))
assert.deepEqual(
  browseShops(tied, { sort: 'highest-rated', categories: [] }).map((s) => s.id),
  ['c', 'b', 'a', 'd']
)
assert.deepEqual(
  browseShops(tied, { sort: 'best-selling', categories: [] }).map((s) => s.id),
  ['c', 'd', 'b', 'a']
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React,{useState}from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{ShopDirectory}from'@/components/shops/shop-directory';import{ShopDirectoryControls}from'@/components/shops/shop-directory-controls';import{defaultShopDirectoryQuery}from'@/lib/shop-directory';import market from '@/components/listings/market-layout.module.css';function App(){const[query,setQuery]=useState(defaultShopDirectoryQuery);const[detail,setDetail]=useState(false);return <LazyMotion features={domAnimation}><main className={market.page}><header data-header className={market.stickyHeader} style={{padding:12,display:'flex',justifyContent:'flex-end'}}><ShopDirectoryControls query={query} onChange={setQuery}/></header><div className={market.content}>{!detail&&<nav>Shop</nav>}<ShopDirectory query={query} onDetailActiveChange={setDetail}/></div></main></LazyMotion>}createRoot(document.getElementById('root')).render(<App/>);`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#0b0b0b;color:white;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
async function main() {
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({ viewport: { width, height: 1000 } })
      p.setDefaultTimeout(10000)
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route('**/*', (r) => {
        const u = new URL(r.request().url())
        if (u.origin !== 'http://localhost:4177')
          throw Error('Unexpected network')
        if (u.pathname === '/')
          return r.fulfill({
            path: path.join(root, 'index.html'),
            contentType: 'text/html',
          })
        if (u.pathname === '/bundle.js')
          return r.fulfill({
            path: path.join(root, 'bundle.js'),
            contentType: 'application/javascript',
          })
        if (
          u.pathname.startsWith('/static/') ||
          u.pathname.startsWith('/demo/')
        )
          return r.fulfill({ path: 'public' + u.pathname })
        throw Error('Unexpected request ' + u.pathname)
      })
      await p.goto('http://localhost:4177/')
      const directory = p.locator('[data-shop-directory-content]'),
        slider = p.locator('[data-overlapping-slider]')
      const order = () =>
        directory
          .locator('[data-directory-shop] [data-shop-card] h3')
          .allTextContents()
      const curated = [
          'Luna Studio',
          'Maple Corner',
          'Campus Tech',
          'Second Story',
          'Studio Thread',
        ],
        ranked = [
          'Second Story',
          'Luna Studio',
          'Studio Thread',
          'Maple Corner',
          'Campus Tech',
        ]
      await directory.locator('[data-directory-shop]').first().waitFor()
      assert.deepEqual(await order(), curated)
      const carousel = await slider
        .locator('[data-shop-card] h3')
        .allTextContents()
      const initialSlider = await slider.elementHandle()
      const sort = p.getByRole('button', { name: 'Sort', exact: true }),
        filter = p.getByRole('button', { name: 'Filter', exact: true })
      const selectSort = async (label) => {
        await sort.focus()
        await p.keyboard.press('Enter')
        const option = p.getByRole('button', { name: label, exact: true })
        await option.focus()
        await p.keyboard.press('Enter')
        await p
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
      }
      const apply = async (cats) => {
        await filter.click()
        const form = p.getByRole('form', { name: 'Shop category filter' })
        for (const name of cats)
          await form.getByRole('checkbox', { name, exact: true }).check()
        const panel = p.getByRole('region', {
          name: 'Filter options',
          exact: true,
        })
        const box = await panel.boundingBox()
        assert(
          box.x >= 0 && box.x + box.width <= width + 1,
          'filter within viewport'
        )
        assert(
          await form.evaluate((n) => n.scrollWidth <= n.clientWidth),
          'long categories do not overflow'
        )
        await form.getByRole('button', { name: 'Apply', exact: true }).click()
        await p
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
      }
      const clear = async () => {
        await filter.click()
        await p
          .getByRole('form', { name: 'Shop category filter' })
          .getByRole('button', { name: 'Clear', exact: true })
          .click()
        await p
          .locator('[data-market-focus-backdrop]')
          .waitFor({ state: 'detached' })
      }
      await selectSort('Highest Rated')
      assert.deepEqual(await order(), ranked)
      await selectSort('Best Selling')
      assert.deepEqual(await order(), ranked)
      await selectSort('Recommended')
      assert.deepEqual(await order(), curated)
      for (const [category, name] of [
        ['Tech & Electronics', 'Campus Tech'],
        ['Books & Stationery', 'Second Story'],
        ['Home & Dorm', 'Maple Corner'],
        ['Fashion & Accessories', 'Studio Thread'],
        ['Art, Crafts & Gifts', 'Luna Studio'],
      ]) {
        await apply([category])
        assert.deepEqual(await order(), [name])
        await clear()
        assert.deepEqual(await order(), curated)
      }
      await apply(['Tech & Electronics', 'Books & Stationery'])
      assert.deepEqual(await order(), ['Campus Tech', 'Second Story'])
      await selectSort('Best Selling')
      assert.deepEqual(await order(), ['Second Story', 'Campus Tech'])
      await clear()
      await apply(['Food & Treats'])
      assert.deepEqual(await order(), [])
      await directory
        .getByText('No shops found in these categories.', { exact: true })
        .waitFor()
      await clear()
      assert.deepEqual(
        await slider.locator('[data-shop-card] h3').allTextContents(),
        carousel,
        'curated carousel never reordered'
      )
      assert(
        await slider.evaluate(
          (node, original) => node === original,
          initialSlider
        ),
        'Sort/Filter preserve the carousel instance'
      )
      await apply(['Art, Crafts & Gifts'])
      const go = directory
        .locator('[data-demo-shop-entry]')
        .getByRole('button', {
          name: 'Go to Luna Studio demo shop',
          exact: true,
        })
      await go.scrollIntoViewIfNeeded()
      const saved = await p.evaluate(() => window.scrollY)
      await go.click()
      await p.locator('[data-shop-detail-demo]').waitFor()
      await p.waitForTimeout(600)
      assert.equal(await p.evaluate(() => window.scrollY), 0)
      const back = p.getByRole('button', {
        name: 'Back to shop list',
        exact: true,
      })
      const b = await back.boundingBox(),
        h = await p.locator('[data-header]').boundingBox()
      assert(Math.abs(b.y - h.y - h.height) < 1)
      // Product sort stays separate and retains its original Newest option.
      const detail = p.locator('[data-shop-detail-demo]')
      assert(
        await detail.getByRole('button', { name: 'Sort', exact: true }).count()
      )
      await p.mouse.move(width / 2, 600)
      await p.mouse.wheel(0, 800)
      await p.waitForTimeout(100)
      await p.mouse.wheel(0, -10000)
      await p.waitForTimeout(200)
      assert.equal(await p.evaluate(() => window.scrollY), 0)
      await back.click()
      await p.waitForTimeout(600)
      assert.equal(await p.evaluate(() => window.scrollY), saved)
      assert.deepEqual(await order(), ['Luna Studio'], 'filter survives Back')
      await filter.click()
      assert(
        await p
          .getByRole('form', { name: 'Shop category filter' })
          .getByRole('checkbox', { name: 'Art, Crafts & Gifts', exact: true })
          .isChecked()
      )
      await p.keyboard.press('Escape')
      await p
        .locator('[data-market-focus-backdrop]')
        .waitFor({ state: 'detached' })
      await clear()
      assert.deepEqual(
        await order(),
        ranked,
        'Best Selling survives Detail and Clear'
      )
      assert.equal(
        await p.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        ),
        false
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS Shop Directory',
        width,
        'actual order, ties, categories, union, clear, keyboard, preserved carousel and Detail scroll/query return'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
