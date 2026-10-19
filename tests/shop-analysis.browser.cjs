/* global window,document,getComputedStyle */
// Offline real dashboard/primitives/dialogs; all analytics explicitly local fixtures.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{ShopAnalysis}from'@/components/shops/shop-analytics';import{loadShopAnalysisFixture,createShopAnalysisFixture,shopAnalysisFixtureAsOf}from'@/lib/fixtures/shop-analysis-fixture';import{calculateShopAnalysis,shopAnalysisBounds}from'@/lib/shop-analysis';const root=createRoot(document.getElementById('root'));let generation=0;window.calls=[];window.renderCase=(access,scenario='normal')=>{const loader=async(range,mode,expenses)=>{window.calls.push({range,mode});if(scenario==='error'&&!window.recover)throw Error('failure');if(scenario==='unauthorized')throw Error('unauthorized');if(scenario==='loading')await new Promise(resolve=>{window.releaseLoad=resolve});let data=await loadShopAnalysisFixture(range,mode,expenses);if(scenario==='empty'||scenario==='missing'||scenario==='loss'){const source=createShopAnalysisFixture(mode);if(scenario==='empty'){source.orders=[];source.expenses=[];source.featured=[]}if(scenario==='missing')source.orders.forEach(o=>o.unitCostSnapshotCents=null);if(scenario==='loss')source.expenses.push({id:'demo-loss',channel:'shop',on:'2026-10-17',kind:'Marketing',amountCents:500000,description:'Loss demo'});const b=shopAnalysisBounds(range,shopAnalysisFixtureAsOf);const {products,featured,...current}=calculateShopAnalysis(source,b.start,b.end);data={...data,current,...(mode==='plus'?{}:{pro:{products,featured}})}}return data};root.render(<LazyMotion features={domAnimation}><main style={{padding:24,maxWidth:1440,margin:'auto'}}><ShopAnalysis key={++generation} demoAccess={access} loadDemo={loader}/></main></LazyMotion>)};`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f8f6fa;font-family:Arial}button{font:inherit}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
async function main() {
  // Resolve the aggregator to its actual Progress module only in this legacy Webpack fixture.
  const progressEntry = path.join(root, 'real-radix-progress.tsx')
  fs.writeFileSync(
    progressEntry,
    `import * as Progress from '@radix-ui/react-progress';export {Progress}`
  )
  await build({ 'radix-ui': progressEntry })
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const reduced of process.env.SHOP_ANALYSIS_PREVIEW_ONLY
      ? [true]
      : [false, true])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        p.setDefaultTimeout(15000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route('**/*', (r) => {
          const u = new URL(r.request().url())
          assert.equal(u.origin, 'http://localhost:4177')
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
          if (u.pathname.startsWith('/static/testPic/')) return r.fulfill({path: path.resolve('public', '.'+u.pathname),contentType:'image/webp'})
          if (u.pathname === '/static/icons/uu-logo.svg')
            return r.fulfill({
              path: path.resolve('public/static/icons/uu-logo.svg'),
              contentType: 'image/svg+xml',
            })
          throw Error('Unexpected request ' + u.pathname)
        })
        await p.goto('http://localhost:4177/')
        assert.equal(
          await p.evaluate(() => typeof window.renderCase),
          'function',
          errors.join('; ')
        )
        await p.evaluate(() => window.renderCase())
        await p.getByRole('table').waitFor()
        assert.equal(
          await p
            .getByRole('button', {
              name: 'Preview demo dashboard',
              exact: true,
            })
            .count(),
          0
        )
        assert.equal(
          await p
            .getByRole('button', { name: 'Demo access', exact: true })
            .count(),
          0
        )
        assert.equal(await p.locator('[data-kpi]').count(), 4)
        assert.equal(await p.getByRole('dialog').count(), 0)
        await p
          .getByRole('heading', { name: 'Total Revenue', exact: true })
          .click()
        const plans = p.getByRole('dialog', {
          name: 'Shop Pro pricing',
          exact: true,
        })
        await plans.waitFor()
        await plans
          .getByRole('button', { name: 'Close Shop Pro pricing', exact: true })
          .click()
        await plans.waitFor({ state: 'detached' })
        await p
          .getByRole('button', { name: 'Add Expense', exact: true })
          .click()
        await plans.waitFor()
        assert.equal(
          await p
            .getByRole('dialog', { name: 'Add demo expense', exact: true })
            .count(),
          0
        )
        await plans
          .getByRole('button', { name: 'Close Shop Pro pricing', exact: true })
          .click()
        await plans.waitFor({ state: 'detached' })
        await p.locator('[data-analysis-preview]').focus()
        await p.keyboard.press('Enter')
        await plans.waitFor()
        await plans
          .getByRole('button', { name: 'Close Shop Pro pricing', exact: true })
          .click()
        await plans.waitFor({ state: 'detached' })
        if (process.env.SHOP_ANALYSIS_PREVIEW_ONLY) {
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
          assert.equal(
            await p
              .getByRole('complementary', { name: 'Demo analytics disclosure' })
              .count(),
            0
          )
          assert.deepEqual(errors, [])
          console.log(
            'PASS direct demo preview, pointer/keyboard plans, no entry/control or demo notice',
            width
          )
          await p.close()
          continue
        }
        await p.evaluate(() => window.renderCase('plus'))
        await p
          .getByRole('region', { name: 'Locked Pro preview', exact: true })
          .waitFor()
        assert.equal(await p.getByRole('table').count(), 0)
        await p.evaluate(() => window.renderCase('pro'))
        const select = async (label, option) => {
          await p.getByRole('button', { name: label, exact: true }).click()
          await p.getByRole('button', { name: option, exact: true }).click()
          await p.waitForTimeout(300)
        }

        await p.getByRole('table').waitFor()
        assert.equal(await p.getByRole('tab').count(), 0)
        assert.equal(await p.locator('[data-slot="progress"]').count(), 10)
        const cols = await p
          .locator('[data-kpi]')
          .evaluateAll((nodes) => nodes.map((n) => n.getBoundingClientRect().x))
        assert.equal(new Set(cols.map(Math.round)).size, width >= 1200 ? 4 : 2)
        const table = p.locator('[data-slot="table-container"]')
        if (width <= 430) {
          assert(await table.evaluate((n) => n.scrollWidth > n.clientWidth))
          await table.focus()
          await p.keyboard.press('ArrowRight')
          await p.waitForTimeout(120)
          assert(await table.evaluate((n) => n.scrollLeft > 0))
        }
        for (const [label, key] of [
          ['This Week', 'week'],
          ['Last Month', 'last-month'],
          ['This Year', 'year'],
          ['This Month', 'month'],
        ]) {
          await select('Date range', label)
          await p.locator('[data-analysis-range="' + key + '"]').waitFor()
          assert.equal(await p.getByRole('table').count(), 1)
        }
        // Existing select keyboard and Escape behavior.
        await p.getByRole('button', { name: 'Date range', exact: true }).focus()
        await p.keyboard.press('Enter')
        await p
          .getByRole('region', { name: 'Date range options', exact: true })
          .waitFor()
        await p.keyboard.press('ArrowDown')
        await p.keyboard.press('Escape')
        await p
          .getByRole('region', { name: 'Date range options', exact: true })
          .waitFor({ state: 'detached' })
        const before = await p
          .locator('[data-kpi="Total Expenses"] span[aria-label]')
          .getAttribute('aria-label')
        await p
          .getByRole('button', { name: 'Add Expense', exact: true })
          .click()
        const dialog = p.getByRole('dialog', {
          name: 'Add demo expense',
          exact: true,
        })
        await dialog.waitFor()
        await dialog
          .getByRole('button', { name: 'Expense Type', exact: true })
          .click()
        await dialog
          .getByRole('button', { name: 'Marketing', exact: true })
          .click()
        await p.waitForTimeout(250)
        await dialog
          .getByRole('textbox', { name: 'Amount (CAD)', exact: true })
          .fill('12.34')
        await dialog
          .getByRole('textbox', { name: 'Description (optional)', exact: true })
          .fill('Demo packaging expense')
        await dialog
          .getByRole('button', { name: 'Add demo expense', exact: true })
          .click()
        await dialog.waitFor({ state: 'detached' })
        await p.waitForFunction(
          (before) =>
            document
              .querySelector('[data-kpi="Total Expenses"] span[aria-label]')
              ?.getAttribute('aria-label') !== before,
          before
        )
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          ),
          'no page horizontal overflow'
        )
        await p.locator('[data-kpi="Total Revenue"]').scrollIntoViewIfNeeded()
        await p.waitForTimeout(reduced ? 30 : 1800)
        const ticker = p.locator('[data-kpi="Total Revenue"] span[aria-label]')
        await p.waitForFunction(
          () => {
            const t = document.querySelector(
              '[data-kpi="Total Revenue"] span[aria-label]'
            )
            return t && t.textContent === t.getAttribute('aria-label')
          },
          null,
          { timeout: 20000 }
        )
        assert.equal(
          await ticker.textContent(),
          await ticker.getAttribute('aria-label')
        )
        const old = await ticker.textContent()
        await p.getByRole('button', { name: 'Date range', exact: true }).focus()
        assert.equal(
          await ticker.textContent(),
          old,
          'ordinary rerender does not reset ticker'
        )
        if (!reduced && [390, 1280].includes(width))
          await p.screenshot({
            path: path.join(root, 'shop-analysis-' + width + '.png'),
            fullPage: true,
          })
        await p.evaluate(() => window.renderCase('trial'))
        await p.getByText(/2-month Pro Trial demo - full Plus/).waitFor()
        assert.equal(await p.getByRole('table').count(), 1)
        assert.deepEqual(errors, [])
        console.log(
          'PASS Shop Analysis',
          width,
          reduced ? 'reduced' : 'normal',
          'Plus lock/plans; Pro/trial; shared ranges; local expense; table/progress; ticker; no overflow'
        )
        await p.close()
      }
    if (process.env.SHOP_ANALYSIS_PREVIEW_ONLY) return
    const p = await browser.newPage({
      viewport: { width: 390, height: 1000 },
      reducedMotion: 'reduce',
    })
    p.setDefaultTimeout(12000)
    await p.route('**/*', (r) =>
      r.fulfill({
        path: path.join(
          root,
          r.request().url().endsWith('bundle.js') ? 'bundle.js' : 'index.html'
        ),
        contentType: r.request().url().endsWith('bundle.js')
          ? 'application/javascript'
          : 'text/html',
      })
    )
    await p.goto('http://localhost:4177/')
    await p.evaluate(() => window.renderCase('pro', 'loading'))
    await p.getByLabel('Loading Shop analytics', { exact: true }).waitFor()
    assert.equal(await p.locator('[data-kpi]').count(), 0)
    await p.evaluate(() => window.releaseLoad())
    await p.getByRole('table').waitFor()
    await p.evaluate(() => window.renderCase('pro', 'error'))
    await p.getByRole('alert').waitFor()
    await p.evaluate(() => (window.recover = true))
    await p.getByRole('button', { name: 'Retry', exact: true }).click()
    await p.getByRole('table').waitFor()
    await p.evaluate(() => window.renderCase('pro', 'unauthorized'))
    await p
      .getByText('You do not have access to this Shop analysis.', {
        exact: false,
      })
      .waitFor()
    assert.equal(await p.getByRole('table').count(), 0)
    await p.evaluate(() => window.renderCase('pro', 'empty'))
    await p.getByText(/No sales data yet/).waitFor()
    await p.getByText(/No featured impressions/).waitFor()
    await p.evaluate(() => window.renderCase('pro', 'missing'))
    await p.getByText(/Profit may be incomplete/).waitFor()
    assert.equal(
      await p.locator('[data-kpi="Estimated Profit"]').textContent(),
      '\u2014'
    )
    await p.evaluate(() => window.renderCase('pro', 'loss'))
    await p.waitForFunction(() =>
      document
        .querySelector('[data-kpi="Estimated Profit"] span[aria-label]')
        ?.getAttribute('aria-label')
        ?.startsWith('-')
    )
    assert(
      await p
        .locator('[data-kpi="Estimated Profit"]')
        .evaluate((n) => getComputedStyle(n).color === 'rgb(238, 141, 157)')
    )
    await p.close()
    console.log(
      'PASS loading, retry, unauthorized, empty sales/featured, missing costs, negative profit'
    )
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
