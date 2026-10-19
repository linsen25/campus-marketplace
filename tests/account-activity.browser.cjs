/* global window, document, getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React,{useRef}from'react';import{createRoot}from'react-dom/client';import{ProfileAnalytics}from'@/components/home/profile-analytics';window.pending=[];window.fixtureRequest=(url)=>url.includes('categories')?Promise.resolve([{category:'Electronics',count:1}]):new Promise((resolve,reject)=>window.pending.push({period:new URL(url,'https://test.invalid').searchParams.get('period'),resolve,reject}));window.answer=(index,fail=false)=>{const r=window.pending[index];if(fail)r.reject(Error('Controlled failure'));else r.resolve({period:r.period,points:Array.from({length:r.period==='1D'?24:parseInt(r.period)},(_,i)=>({timestamp:new Date(Date.UTC(2026,9,i+1)).toISOString(),label:String(i),views:0,listings:0,sold:0,overall:0}))})};function App(){const h=useRef({activity:0,marketplace:0});return <ProfileAnalytics replayToken={1} replayHistory={h}/>};createRoot(document.getElementById('root')).render(<App/>);`
)
;(async () => {
  await build(aliases)
  for (const f of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, f))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await b.newPage({ viewport: { width, height: 900 } })
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const a = p.getByRole('region', { name: 'Your Activity', exact: true })
      const button = (n) => a.getByRole('button', { name: n, exact: true })
      await button('Overall').waitFor()
      const control = await button('Overall').elementHandle(),
        panel = await a.elementHandle()
      await a.getByRole('status').waitFor()
      await p.evaluate(() => window.answer(0, true))
      await a.getByRole('alert').waitFor()
      assert.equal(await a.getByRole('status').count(), 0)
      assert(await control.evaluate((n) => n.isConnected))
      await button('Retry').click()
      await p.waitForFunction(() => window.pending.length === 2)
      await p.evaluate(() => window.answer(1))
      await a.locator('.recharts-area-curve').waitFor({ state: 'attached' })
      assert.equal(await a.getByText('Demo data', { exact: true }).count(), 0)
      for (const name of ['Views', 'Listings', 'Sold', 'Overall']) {
        await button(name).click()
        assert.equal(await button(name).getAttribute('aria-pressed'), 'true')
        assert.equal(
          await button(name).evaluate(
            (n) => getComputedStyle(n).backgroundColor
          ),
          'rgb(124, 58, 237)'
        )
        assert.equal(
          await a.locator('.recharts-area-curve').getAttribute('stroke'),
          '#7C3AED'
        )
        assert.equal(await a.getByRole('status').count(), 0)
      }
      assert.equal(
        await button('7D').evaluate((n) => getComputedStyle(n).backgroundColor),
        'rgb(124, 58, 237)'
      )
      await p.waitForTimeout(1600)
      const key = await a.getAttribute('data-chart-replay')
      await button('1D').click()
      await p.waitForFunction(() => window.pending.length === 3)
      assert.equal(
        await a
          .locator('[data-trend-period]')
          .getAttribute('data-trend-period'),
        '7D'
      )
      assert.equal(await a.getByRole('status').count(), 0)
      assert.equal(await a.getAttribute('data-chart-replay'), key)
      await button('30D').click()
      await p.waitForFunction(() => window.pending.length === 4)
      await p.evaluate(() => window.answer(3))
      await p.waitForFunction(
        () =>
          document
            .querySelector('[data-trend-period]')
            ?.getAttribute('data-trend-period') === '30D'
      )
      await p.evaluate(() => window.answer(2))
      await p.waitForTimeout(1800)
      assert.equal(
        await a
          .locator('[data-trend-period]')
          .getAttribute('data-trend-period'),
        '30D'
      )
      assert(await control.evaluate((n) => n.isConnected))
      assert(await panel.evaluate((n) => n.isConnected))
      assert.equal(
        await button('30D').evaluate(
          (n) => getComputedStyle(n).backgroundColor
        ),
        'rgb(124, 58, 237)'
      )
      for (const [period, index] of [
        ['1D', 4],
        ['7D', 5],
      ]) {
        await button(period).click()
        await p.waitForFunction((n) => window.pending.length === n, index + 1)
        await p.evaluate((n) => window.answer(n), index)
        await p.waitForFunction(
          (value) =>
            document
              .querySelector('[data-trend-period]')
              ?.getAttribute('data-trend-period') === value,
          period
        )
        assert.equal(
          await button(period).evaluate(
            (n) => getComputedStyle(n).backgroundColor
          ),
          'rgb(124, 58, 237)'
        )
        assert.equal(await a.getByRole('status').count(), 0)
      }
      const trends = p.getByRole('region', {
        name: 'Marketplace Trends',
        exact: true,
      })
      await trends
        .locator('.recharts-bar-rectangle path')
        .first()
        .waitFor({ state: 'attached' })
      assert.equal(
        await trends
          .locator('.recharts-bar-rectangle path')
          .first()
          .getAttribute('fill'),
        'var(--color-count)'
      )
      assert.equal(
        await trends
          .locator('[data-chart]')
          .first()
          .evaluate((n) =>
            getComputedStyle(n).getPropertyValue('--color-count').trim()
          ),
        '#7C3AED'
      )
      await p.screenshot({
        path: path.join(root, 'profile-primary-purple-' + width + '.png'),
        fullPage: true,
      })
      const box = await a.locator('[data-chart]').boundingBox()
      assert.equal(box.height, 260)
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      console.log(
        'PASS Activity ' +
          width +
          ': initial contained loading/error/retry, zero data, retained pending chart, stale response ignored, stable controls/panel, 260px geometry, no overflow'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
