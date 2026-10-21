/* global window, document */
// Actual shared Analysis and B18 ExpenseDialog; controlled local API only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
function mock(name, source) {
  const file = path.join(root, 'b19-' + Object.keys(aliases).length + '.tsx')
  fs.writeFileSync(file, source)
  aliases[name] = file
  if (name.startsWith('@/')) aliases['./' + path.basename(name)] = file
}
mock(
  '@/components/listings/marketplace-session',
  `export function useMarketplaceSession(){return window.session}`
)
const payload = require('./shop-analysis-b19-fixture.cjs')()
const progress = path.join(root, 'b19-progress.tsx')
fs.writeFileSync(
  progress,
  "import * as Progress from '@radix-ui/react-progress';export {Progress}"
)
aliases['radix-ui'] = progress
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `
import 'tailwindcss/src/css/preflight.css';import '@/components/animata/button/shining-button.css';import React from'react';import{createRoot}from'react-dom/client';import{LazyMotion,domAnimation}from'framer-motion';import{ShopAnalysis}from'@/components/shops/shop-analytics';
window.process={env:{}};window.session={seller:{id:'owner'},loading:false,error:''};window.calls=[];window.mode='plus';window.release=[];window.seed=${JSON.stringify(
    payload
  )};
window.fixtureRequest=async(url,method,body)=>{window.calls.push({url,method,body,owner:window.session.seller?.id});if(url==='/api/shop/expenses'&&method==='POST'){if(window.expenseFail)throw Error('Expense unavailable');window.expenseSaved=body;return {...body,deletedAt:null}};if(!url.startsWith('/api/shop/analysis?range='))throw Error('Unexpected API '+url);if(window.mode==='error'||window.mode==='suspended')throw Error('Not authorized');const d=JSON.parse(JSON.stringify(window.seed));d.asOf=new Date().toISOString();d.range=new URL(url,'http://localhost').searchParams.get('range');d.access=window.mode==='pro'?'pro':'plus';d.nextBoundaryAt=new Date(Date.now()+(window.expireSoon?250:86400000)).toISOString();if(window.mode==='partial'){d.current.revenueCents=null;d.current.estimatedProfitCents=null;d.current.missingCostCount=1;d.current.coverage.profitComplete=false};if(window.mode==='empty'){d.current.revenueCents=0;d.current.sold=0;d.current.orders.completed=0;d.current.estimatedProfitCents=0;d.pro.products=[];d.pro.topProducts=[];d.pro.distribution=[]};if(window.mode==='hold')return new Promise(resolve=>window.release.push(()=>resolve(d)));return d};
const r=createRoot(document.getElementById('root'));let generation=0;window.render=()=>r.render(<LazyMotion features={domAnimation}><main style={{padding:24,maxWidth:1440,margin:'auto'}}><ShopAnalysis replayToken={++generation}/></main></LazyMotion>);window.render();
`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f8f6fa;font-family:Arial}button{font:inherit}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
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
    for (const reduced of [false, true])
      for (const width of [390, 430, 820, 1280, 1536]) {
        const p = await browser.newPage({
          viewport: { width, height: 1000 },
          reducedMotion: reduced ? 'reduce' : 'no-preference',
        })
        p.setDefaultTimeout(15000)
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => r.abort())
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        let region = p.getByRole('region', {
          name: 'Real Shop analytics',
          exact: true,
        })
        await region.waitFor().catch(async (e) => {
          console.error(
            await p.locator('body').innerText(),
            errors,
            await p.evaluate(() => window.calls)
          )
          throw e
        })
        await region
          .getByText('Recorded Product Sales', { exact: true })
          .waitFor()
        assert.equal(
          await region
            .getByText('Product Performance', { exact: true })
            .count(),
          1
        )
        assert.equal(
          await region
            .getByText('Featured Shop Performance', { exact: true })
            .count(),
          0
        )
        assert.equal(await p.getByText(/Demo Shop analytics/).count(), 0)
        await p.getByRole('button', { name: 'Date range', exact: true }).click()
        await p.getByRole('button', { name: 'This Week', exact: true }).click()
        await p.waitForFunction(
          () =>
            document
              .querySelector('[aria-label="Real Shop analytics"]')
              ?.getAttribute('data-analysis-range') === 'week'
        )
        await p
          .locator('[aria-label="Date range options"]')
          .waitFor({ state: 'detached' })
        await p.evaluate(() => {
          window.clickTargets = []
          document.addEventListener('click', (e) =>
            window.clickTargets.push(e.target.closest('button')?.textContent)
          )
        })
        await region
          .getByRole('button', { name: 'Add Expense', exact: true })
          .click()
        let d = p.getByRole('dialog', { name: 'Add expense', exact: true })
        await d
          .getByRole('textbox', { name: 'Amount (CAD)', exact: true })
          .fill('12.34')
          .catch(async (e) => {
            console.error(
              await p.locator('body').innerText(),
              errors,
              await p.evaluate(() => ({
                calls: window.calls,
                clicks: window.clickTargets,
              }))
            )
            throw e
          })
        await p.evaluate(() => (window.expenseFail = true))
        await d
          .getByRole('button', { name: 'Add expense', exact: true })
          .click()
        await d.getByText('Expense unavailable', { exact: true }).waitFor()
        await p.evaluate(() => (window.expenseFail = false))
        await d
          .getByRole('button', { name: 'Add expense', exact: true })
          .click()
        await d.waitFor({ state: 'detached' })
        await region.waitFor()
        assert.equal(
          await p.evaluate(() => window.expenseSaved.amountCents),
          1234
        )
        assert.equal(
          await p.evaluate(
            () =>
              new Set(
                window.calls
                  .filter((x) => x.method === 'POST')
                  .map((x) => x.body.id)
              ).size
          ),
          1
        )
        const refresh = async (mode) => {
          await p.evaluate((mode) => {
            window.mode = mode
            window.dispatchEvent(new window.Event('focus'))
          }, mode)
        }
        await refresh('pro')
        await region
          .getByText('Featured Shop Performance', { exact: true })
          .waitFor()
        await region.getByText(/Promotion performance is unavailable/).waitFor()
        await refresh('partial')
        await region.getByText(/Profit is unavailable because/).waitFor()
        assert.equal(
          await p.locator('[data-kpi="Recorded Product Sales"]').innerText(),
          '—'
        )
        assert.equal(
          await p.locator('[data-kpi="Estimated Profit"]').innerText(),
          '—'
        )
        await refresh('empty')
        await region
          .getByText(
            'No attributable completed Shop sales in this period. Missing historical facts, if any, are listed above.',
            { exact: true }
          )
          .waitFor()
        await refresh('error')
        await p.getByRole('alert').waitFor()
        assert.equal(await region.count(), 0)
        assert.equal(await p.locator('[data-analysis-preview]').count(), 0)
        await p.evaluate(() => (window.mode = 'plus'))
        await p.getByRole('button', { name: 'Retry', exact: true }).click()
        await region.waitFor()
        await refresh('hold')
        await p.getByLabel('Loading Shop analytics', { exact: true }).waitFor()
        await p.waitForFunction(() => window.release.length > 0)
        await p.evaluate(() => {
          window.session = {
            seller: { id: 'other' },
            loading: false,
            error: '',
          }
          window.mode = 'suspended'
          window.render()
        })
        await p.getByRole('alert').waitFor()
        await p.evaluate(() => window.release.forEach((fn) => fn()))
        assert.equal(await region.count(), 0)
        await p.evaluate(() => {
          window.session = {
            seller: { id: 'owner' },
            loading: false,
            error: '',
          }
          window.mode = 'plus'
          window.expireSoon = true
          window.render()
        })
        await p.waitForFunction(
          () =>
            window.calls.filter(
              (x) => x.owner === 'owner' && x.url.includes('analysis')
            ).length > 4
        )
        await p.evaluate(() => {
          window.mode = 'suspended'
          window.expireSoon = false
        })
        await p.getByRole('alert').waitFor()
        assert.equal(await region.count(), 0)
        await p.evaluate(() => {
          window.mode = 'pro'
          window.dispatchEvent(new window.Event('focus'))
        })
        await region.waitFor()
        const salesTicker = p.locator(
          '[data-kpi="Recorded Product Sales"] span[aria-label]'
        )
        await salesTicker.scrollIntoViewIfNeeded()
        await p.waitForFunction(() => {
          const element = document.querySelector(
            '[data-kpi="Recorded Product Sales"] span[aria-label]'
          )
          return (
            element &&
            element.textContent === element.getAttribute('aria-label')
          )
        })
        await p.evaluate(() => window.scrollTo(0, 0))
        await p.screenshot({
          path: path.join(root, `b19-real-${width}-${reduced}.png`),
          fullPage: true,
        })
        assert(
          await p.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        assert.deepEqual(errors, [])
        await p.close()
        console.log(
          'PASS B19 real Analysis ' +
            width +
            ' reduced=' +
            reduced +
            ': Plus products, Pro unavailable attribution, period, B18 expense/retry, partial/empty/error, no Demo fallback, account late-response isolation and expiry; no overflow'
        )
      }
  } finally {
    await browser.close()
  }
}
main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
