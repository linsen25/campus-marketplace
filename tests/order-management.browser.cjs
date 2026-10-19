const { testPictureDataUrl } = require('../scripts/lib/test-pictures.cjs')
/* global window, document, getComputedStyle */
// Real Purchases/Sales list, classification and navigation. Offline transport only.
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const aliases = require('./browser-fixture-mocks.cjs')(root)
let mockIndex = 0
function mock(name, source) {
  const file = path.join(root, 'order-list-' + mockIndex++ + '.tsx')
  fs.writeFileSync(file, source)
  aliases[name] = file
  if (name.startsWith('@/')) aliases['./' + path.basename(name)] = file
}
mock(
  '@/hooks/use-formal-orders',
  `export function useFormalOrders(mode){window.reads.push(mode);return {loading:window.loading,error:window.error,userId:'viewer',data:window.loading||window.noData?null:{orders:window.orders.filter(order=>mode==='sales'?order.sellerId==='viewer':order.buyerId==='viewer')},offset:0,refresh:async()=>{window.retries++;window.error='';window.noData=false;window.renderModel()},refreshOrder(){throw Error('Unexpected detail read')},applyOrder(){throw Error('Unexpected mutation')}}}`
)
mock(
  'next/router',
  `export function useRouter(){return {query:window.query,pathname:'/home',push:async (target,a,options)=>{window.navigation.push({target,options});window.query=target.query;window.renderModel()}}}`
)
mock(
  '@/components/home/formal-order-detail',
  `export function FormalOrderDetail({order,mode,onBack}){return <section aria-label="Existing Order Detail"><p>{mode}:{order.id}</p><button onClick={onBack}>Back to {mode==='sales'?'Sales':'Purchases'}</button></section>}`
)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  `import 'tailwindcss/src/css/preflight.css';import React from'react';import{createRoot}from'react-dom/client';import{flushSync}from'react-dom';import{LazyMotion,domAnimation}from'framer-motion';import{FormalOrders}from'@/components/home/formal-orders';const root=createRoot(document.getElementById('root'));window.renderModel=()=>flushSync(()=>root.render(<LazyMotion features={domAnimation}><main style={{padding:24}}><FormalOrders key={window.mode} mode={window.mode}/></main></LazyMotion>));`
)
fs.writeFileSync(
  path.join(root, 'index.html'),
  '<meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;background:#21182b;color:#f5f3f7;font-family:Arial}</style><script>window.process={env:{}}</script><div id="root"></div><script src="bundle.js"></script>'
)
async function run() {
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536])
      for (const reduced of ['reduce', 'no-preference']) {
        const p = await browser.newPage({
          viewport: { width, height: 900 },
          reducedMotion: reduced,
        })
        const errors = []
        p.on('pageerror', (e) => errors.push(e.message))
        await p.route(/^https?:/, (r) => {
          throw Error('Unexpected network ' + r.request().url())
        })
        await p.addInitScript({
          content:
            'window.fixturePhoto=' +
            JSON.stringify(testPictureDataUrl('monitor')),
        })
        await p.goto(
          'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
        )
        await p.evaluate(() => {
          window.orders = []
          window.reads = []
          window.navigation = []
          window.loading = false
          window.error = ''
          window.retries = 0
          window.noData = false
          const photo = window.fixturePhoto
          for (const mode of ['purchases', 'sales'])
            for (const [i, lifecycle] of [
              'open',
              'open',
              'completed',
              'cancelled',
              'expired',
              'open',
            ].entries())
              window.orders.push({
                id: mode + '-' + i,
                protocolVersion: 2,
                buyerId: mode === 'purchases' ? 'viewer' : 'other',
                sellerId: mode === 'sales' ? 'viewer' : 'other',
                snapshot: {
                  listing: {
                    title:
                      mode +
                      ' ' +
                      (i === 0
                        ? 'Long product title '.repeat(10)
                        : 'Item ' + i),
                    photoUrls: i === 1 ? [] : [photo],
                  },
                  draft: { fulfillment: 'meet' },
                },
                lifecycle,
                paymentStatus: i === 5 ? 'refunded' : 'pending',
                itemAmount: 8000,
                reservationExpiresAt: null,
                createdAt: '2026-10-16T12:00:00Z',
                updatedAt: '2026-10-17T12:00:00Z',
                v2: {
                  terms: {
                    fulfillment: i === 1 ? 'delivery' : 'on_campus',
                    ...(i === 1 ? { deliveryMethod: 'courier' } : {}),
                    paymentMode: 'uu_pay',
                  },
                },
              })
        })
        for (const mode of ['purchases', 'sales']) {
          await p.evaluate((mode) => {
            window.mode = mode
            window.query = { section: 'orders', destination: mode }
            window.reads = []
            window.navigation = []
            window.renderModel()
          }, mode)
          const cards = p.locator('[data-order-list-card]')
          await cards.first().waitFor()
          assert.equal(await cards.count(), 2)
          assert(
            (await p.evaluate(() => window.reads)).every((x) => x === mode)
          )
          assert(
            (
              await cards.evaluateAll((nodes) =>
                nodes.map((n) => n.getAttribute('data-order-list-card'))
              )
            ).every((id) => id.startsWith(mode))
          )
          const active = p.getByRole('button', {
              name: 'Active 2',
              exact: true,
            }),
            history = p.getByRole('button', { name: 'History', exact: true })
          assert.equal(await active.getAttribute('aria-pressed'), 'true')
          const tabs = await p
            .getByRole('group', { name: 'Order list view' })
            .boundingBox()
          assert(tabs.width >= (width <= 767 ? 220 : 210) && tabs.width <= 300)
          const first = cards.first(),
            image = first.locator('img')
          await image.evaluate((e) => e.decode())
          // The approved square is the clipping media container, not the
          // intrinsic portrait photograph's box inside its centered grid slot.
          const media = image.locator('..').locator('..')
          const imageBox = await media.boundingBox()
          assert(Math.abs(imageBox.width - imageBox.height) < 1)
          assert.equal(
            await media.evaluate((e) => getComputedStyle(e).overflow),
            'hidden'
          )
          assert.equal(
            await image.evaluate((n) => getComputedStyle(n).objectFit),
            'cover'
          )
          await p.getByText('No photo available', { exact: true }).waitFor()
          assert.equal(await p.getByText(/On Campus/).count(), 0)
          assert((await first.textContent()).includes('Meeting'))
          await p.screenshot({
            path: path.join(
              root,
              `orders-${mode}-active-${width}-${reduced}.png`
            ),
          })
          const visibleAction =
            width <= 767
              ? first.getByRole('button', { name: /View Order:/ })
              : first.getByRole('button', { name: 'View Order', exact: true })
          assert(await visibleAction.isVisible())
          if (width <= 767) {
            assert.equal(
              await first
                .getByRole('button', { name: 'View Order', exact: true })
                .count(),
              0
            )
            const titleBox = await first.locator('h4').boundingBox()
            await p.mouse.click(titleBox.x + 5, titleBox.y + 5)
          } else await visibleAction.click()
          await p
            .getByRole('region', { name: 'Existing Order Detail' })
            .waitFor()
          const nav = await p.evaluate(() => window.navigation.at(-1))
          assert.equal(nav.target.query.destination, mode)
          assert.equal(nav.target.query.order, mode + '-0')
          assert.equal(nav.options.shallow, true)
          await p
            .getByRole('button', {
              name: mode === 'sales' ? 'Back to Sales' : 'Back to Purchases',
              exact: true,
            })
            .click()
          await p.evaluate(() => {
            window.originalOrderTabs = document.querySelector(
              '[aria-label="Order list view"]'
            )
            window.originalTabsRect = window.originalOrderTabs
              .getBoundingClientRect()
              .toJSON()
          })
          await history.click()
          await p.waitForTimeout(260)
          assert(
            await p.evaluate(
              () =>
                window.originalOrderTabs ===
                document.querySelector('[aria-label="Order list view"]')
            ),
            'Same switcher DOM survives tab change'
          )
          const stability = await p.evaluate(() => {
            const r = window.originalOrderTabs.getBoundingClientRect()
            return {
              dx: r.x - window.originalTabsRect.x,
              dy: r.y - window.originalTabsRect.y,
            }
          })
          assert(
            Math.abs(stability.dx) < 1 && Math.abs(stability.dy) < 1,
            'Switcher position unchanged'
          )
          assert.equal(
            (await p.evaluate(() => window.navigation.at(-1))).options.scroll,
            false
          )
          assert.equal(
            await history
              .locator('[class*="indicator"]')
              .evaluate((e) => getComputedStyle(e).backgroundColor),
            'rgb(124, 58, 237)'
          )
          assert.equal(await history.getAttribute('aria-pressed'), 'true')
          assert.equal(await cards.count(), 4)
          assert.equal(
            await p.locator('[data-order-terminal="Completed"]').count(),
            1
          )
          assert.equal(
            await p.locator('[data-order-terminal="Cancelled"]').count(),
            1
          )
          assert.equal(
            await p.locator('[data-order-terminal="Expired"]').count(),
            1
          )
          assert.equal(
            await p.locator('[data-order-terminal="Refunded"]').count(),
            1
          )
          const terminal = cards.first()
          await terminal
            .getByRole('button', {
              name: width <= 767 ? /View details:/ : 'View details',
              exact: width > 767,
            })
            .press('Enter')
          await p
            .getByRole('region', { name: 'Existing Order Detail' })
            .waitFor()
          assert.equal(
            (await p.evaluate(() => window.navigation.at(-1))).target.query
              .orderView,
            'history'
          )
          await p.getByRole('button', { name: /Back to/ }).click()
          await p.screenshot({
            path: path.join(root, `orders-${mode}-${width}-${reduced}.png`),
          })
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            )
          )
          assert.deepEqual(errors, [])
        }
        await p.evaluate(() => {
          window.orders = []
          window.query = { section: 'orders', destination: window.mode }
          window.renderModel()
        })
        await p.getByText('No active orders', { exact: true }).waitFor()
        assert.equal(await cardsCount(p), 0)
        await p.evaluate(() => {
          window.loading = true
          window.renderModel()
        })
        await p.getByRole('status', { name: 'Loading orders' }).waitFor()
        assert.equal(await cardsCount(p), 0)
        await p.evaluate(() => {
          window.loading = false
          window.noData = true
          window.error = 'Offline fixture failure'
          window.renderModel()
        })
        await p
          .getByRole('alert')
          .getByText('Offline fixture failure', { exact: true })
          .waitFor()
        await p.getByRole('button', { name: 'Retry', exact: true }).click()
        await p.getByText('No active orders', { exact: true }).waitFor()
        assert.equal(await p.evaluate(() => window.retries), 1)
        console.log(
          'PASS Purchases/Sales order management',
          width,
          reduced,
          'classification, loaded count, images, full-card mobile, desktop CTA, shallow detail/back, empty/loading/retry, perspective isolation'
        )
        await p.close()
      }
  } finally {
    await browser.close()
  }
}
async function cardsCount(p) {
  return p.locator('[data-order-list-card]').count()
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
