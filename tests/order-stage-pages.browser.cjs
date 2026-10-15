// Real components/hooks with isolated offline HTTP projections; no hosted data.
/* global window, document, navigator, getComputedStyle */
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
// Mobile intentionally has no historical-stage Back. Qualify that navigation
// separately; the original backward-browsing matrix remains the desktop contract.
if (!process.env.ORDER_UI_WIDTH || Number(process.env.ORDER_UI_WIDTH) < 1024) {
  const result = require('node:child_process').spawnSync(
    process.execPath,
    [
      '--openssl-legacy-provider',
      path.join(__dirname, 'order-mobile-navigation.browser.cjs'),
    ],
    { stdio: 'inherit', env: process.env }
  )
  assert.equal(result.status, 0, 'Mobile Order navigation qualification failed')
}
const original = fs.readFileSync(
  path.join(__dirname, 'order-flow-ui.browser.cjs'),
  'utf8'
)
const { root, build } = require('./message-payload.browser.cjs')
// Reuse the existing isolated synthetic transport, without its CLI entry point.
new Function(
  'require',
  original.slice(
    0,
    original.indexOf('// Stage-based qualification entry point')
  )
)(require)
const id = 'fda25a07-1c57-483e-93f1-2ae81b39b6c7'
let fixture = fs
  .readFileSync(path.join(root, 'entry.tsx'), 'utf8')
  .replaceAll('order-1', id)
fixture = fixture.replace(
  'window.renderModel();};',
  `if(v.viewer==='seller'&&!paid)window.model.checkout.address=null;window.renderModel();};`
)
fs.writeFileSync(path.join(root, 'entry.tsx'), fixture)
async function run() {
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  fs.writeFileSync(
    path.join(root, 'link-mock.tsx'),
    'export const Link=({children,...props})=><a {...props}>{children}</a>'
  )
  aliases['@ui/link/link'] = path.join(root, 'link-mock.tsx')
  await build(aliases)
  for (const name of ['entry.tsx', 'api.ts', 'link-mock.tsx'])
    fs.unlinkSync(path.join(root, name))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let cases = 0
  try {
    for (const width of [1280, 1536].filter(
      (width) =>
        !process.env.ORDER_UI_WIDTH ||
        width === Number(process.env.ORDER_UI_WIDTH)
    )) {
      const page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      page.on('pageerror', (e) => errors.push(e.message))
      await page.addInitScript(() => {
        window.process = { env: {} }
        window.copied = ''
        Object.defineProperty(navigator, 'clipboard', {
          value: {
            writeText: async (text) => {
              window.copied = text
            },
          },
        })
      })
      await page.route(/^https?:/, (route) => route.abort())
      await page.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const rootNode = page.getByRole('region', {
        name: 'Order Detail',
        exact: true,
      })
      const nav = page.getByRole('navigation', {
        name: 'Order page navigation',
      })
      const go = async (name) => {
        await nav.getByRole('button', { name, exact: true }).click()
        await page.waitForTimeout(250)
      }
      await require('./order-detail-polish.browser.cjs')(page, width)
      if (process.env.ORDER_UI_POLISH_ONLY) {
        assert.deepEqual(errors, [])
        await page.close()
        continue
      }
      const assertLayout = async () => {
        assert.equal(await page.getByRole('tab').count(), 0)
        assert.equal(
          await page
            .getByRole('region', { name: 'Current Step' })
            .getByRole('button', { name: /^(Back|Next)$/ })
            .count(),
          0
        )
        assert(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth
          )
        )
        const back = nav.locator('[data-action-direction="back"]')
        if (await back.count()) {
          assert.equal(
            await back
              .locator('.shining-button__arrow')
              .evaluate((e) => getComputedStyle(e).rotate),
            '180deg'
          )
          assert.equal(
            await back
              .locator('.shining-button__body')
              .evaluate((e) => getComputedStyle(e).backgroundColor),
            'rgb(36, 91, 156)'
          )
        }
        assert(
          await rootNode.evaluate((e) => {
            const p = e.querySelector('[aria-label="Order Progress"]'),
              s = e.querySelector('[aria-label="Current Step"]'),
              n = e.querySelector('nav')
            return (
              p.getBoundingClientRect().bottom <=
                s.getBoundingClientRect().top &&
              (!n ||
                s.getBoundingClientRect().bottom <=
                  n.getBoundingClientRect().top)
            )
          })
        )
      }
      for (const mode of ['campus', 'seller_delivery', 'courier'])
        for (const viewer of ['buyer', 'seller']) {
          const phases = [
            'review',
            'processing',
            'paid',
            'protection',
            'hold',
            'completed',
            'cancelled',
            'expired',
          ]
          if (mode === 'courier') phases.push('shipped', 'delivered')
          for (const phase of phases) {
            await page.evaluate((v) => window.setScenario(v), {
              mode,
              viewer,
              phase,
              startedDelivery: phase === 'paid' && mode === 'seller_delivery',
            })
            await page.waitForTimeout(120)
            await assertLayout()
            const initial = await rootNode.getAttribute('data-order-page')
            const firstPosts = await page.evaluate(
              () => window.requests.filter((r) => r.method === 'POST').length
            )
            const progress = await page
              .getByRole('region', { name: 'Order Progress' })
              .innerText()
            const markers = await page
              .locator('[data-slot="stepper"] li')
              .evaluateAll((items) =>
                items.map((e) => [
                  e.getAttribute('data-done'),
                  e.getAttribute('aria-current'),
                  e.getAttribute('aria-label'),
                ])
              )
            if (['completed', 'cancelled', 'expired'].includes(phase)) {
              assert.equal(
                await nav.count(),
                0,
                'Historical detail has no bottom navigation container'
              )
              assert.equal(
                await page
                  .getByRole('button', { name: /^Back to (Purchases|Sales)$/ })
                  .count(),
                1
              )
            }
            if (phase === 'review') {
              while (
                await nav
                  .getByRole('button', { name: 'Back', exact: true })
                  .count()
              )
                await go('Back')
              await page
                .getByRole('region', { name: 'Agreement / Terms', exact: true })
                .waitFor()
              assert(
                await page
                  .getByRole('region', { name: 'Confirmed Offer', exact: true })
                  .getByText('Buyer', { exact: true })
                  .count()
              )
              assert.equal(
                await page
                  .getByRole('region', { name: 'Confirmed Offer', exact: true })
                  .getByText('Confirmed', { exact: true })
                  .count(),
                1
              )
              assert.equal(
                await page
                  .getByRole('region', { name: 'Original Offer', exact: true })
                  .getByText('Original asking price', { exact: true })
                  .count(),
                1
              )
              assert.equal(
                await page
                  .getByText('FDA25A071C57483E93F12AE81B39B6C7', {
                    exact: true,
                  })
                  .count(),
                1
              )
              await page
                .getByRole('button', { name: 'Copy order number', exact: true })
                .click()
              assert.equal(
                await page.evaluate(() => window.copied),
                'FDA25A071C57483E93F12AE81B39B6C7'
              )
              assert.equal(
                await page
                  .getByText('You saved CA$10.00', { exact: true })
                  .count(),
                viewer === 'buyer' ? 1 : 0
              )
              while (
                await nav
                  .getByRole('button', { name: 'Next', exact: true })
                  .count()
              ) {
                await go('Next')
                assert.equal(
                  await page
                    .getByRole('region', {
                      name: 'Agreement / Terms',
                      exact: true,
                    })
                    .count(),
                  0
                )
                await assertLayout()
              }
            } else if (
              await nav
                .getByRole('button', { name: 'Back', exact: true })
                .count()
            ) {
              await go('Back')
              assert.equal(
                await page
                  .getByRole('region', { name: 'Current-stage actions' })
                  .getByRole('button')
                  .count(),
                0,
                'Past stages are read-only'
              )
              await go('Next')
            }
            assert.equal(
              await page
                .getByRole('region', { name: 'Order Progress' })
                .innerText(),
              progress
            )
            assert.deepEqual(
              await page
                .locator('[data-slot="stepper"] li')
                .evaluateAll((items) =>
                  items.map((e) => [
                    e.getAttribute('data-done'),
                    e.getAttribute('aria-current'),
                    e.getAttribute('aria-label'),
                  ])
                ),
              markers
            )
            assert.equal(
              await page.evaluate(
                () => window.requests.filter((r) => r.method === 'POST').length
              ),
              firstPosts,
              'Navigation/copy never writes'
            )
            const current = await rootNode.getAttribute('data-order-page')
            if (['review', 'processing'].includes(phase)) {
              assert.equal(current, 'payment')
              assert.equal(await page.locator('[data-handoff-code]').count(), 0)
            }
            if (['protection', 'hold', 'delivered'].includes(phase)) {
              assert.equal(current, 'protection')
              assert.equal(
                await page
                  .getByRole('region', { name: 'Cancel Order', exact: true })
                  .count(),
                0
              )
            }
            if (mode === 'courier') {
              assert.equal(await page.locator('[data-handoff-code]').count(), 0)
              assert.equal(
                await page.locator('[aria-label="Handoff QR area"]').count(),
                0
              )
            }
            if (phase === 'paid' && mode !== 'courier') {
              if (mode === 'campus') {
                await go('Next')
                assert.equal(
                  await rootNode.getAttribute('data-order-page'),
                  'handoff'
                )
                assert.equal(
                  await page
                    .getByRole('region', { name: 'Order Progress' })
                    .innerText(),
                  progress
                )
              }
              assert.equal(
                await page.locator('[aria-label="Handoff QR area"]').count(),
                1
              )
              assert.equal(
                await page.locator('[data-handoff-code]').count(),
                viewer === 'buyer' ? 1 : 0
              )
            }
            await page.evaluate(() => {
              const m = window.model
              m.key += ':remount'
              window.renderModel()
            })
            await page.waitForTimeout(100)
            assert.equal(
              await rootNode.getAttribute('data-order-page'),
              initial,
              'Remount reconstructs authoritative presentation'
            )
            cases++
          }
          // Real-action boundary checks, locally mocked only.
          await page.evaluate((v) => window.setScenario(v), {
            mode,
            viewer,
            phase: 'review',
          })
          await page.waitForTimeout(100)
          await go('Next')
          if (viewer === 'seller')
            assert.equal(
              await page.getByRole('button', { name: /^Pay/ }).count(),
              0
            )
          else if (mode === 'campus') {
            await page
              .getByRole('button', { name: 'Pay (staging test)', exact: true })
              .click()
            await page.waitForFunction(() =>
              window.requests.some(
                (r) => r.method === 'POST' && r.url.endsWith('/payment/start')
              )
            )
            await page.waitForTimeout(150)
            assert.equal(
              await rootNode.getAttribute('data-order-page'),
              'fulfillment'
            )
          }
          if (mode === 'seller_delivery') {
            await page.evaluate((v) => window.setScenario(v), {
              mode,
              viewer,
              phase: 'paid',
              startedDelivery: false,
            })
            await page.waitForTimeout(120)
            assert.equal(
              await nav
                .getByRole('button', { name: 'Next', exact: true })
                .count(),
              0
            )
            assert.equal(
              await page
                .getByRole('button', { name: 'Start delivery', exact: true })
                .count(),
              viewer === 'seller' ? 1 : 0
            )
            if (viewer === 'seller') {
              if (width === 390) {
                await page.evaluate(() => (window.rejectWrites = true))
                await page
                  .getByRole('button', { name: 'Start delivery', exact: true })
                  .click()
                await page
                  .getByText('Controlled mutation failure', { exact: true })
                  .waitFor()
                await page.waitForFunction(() =>
                  Array.from(document.querySelectorAll('button')).some(
                    (button) =>
                      button.textContent.includes('Start delivery') &&
                      !button.disabled &&
                      button.getAttribute('aria-disabled') !== 'true' &&
                      button.getAttribute('aria-busy') !== 'true'
                  )
                )
                assert.equal(
                  await page
                    .getByRole('button', {
                      name: 'Start delivery',
                      exact: true,
                    })
                    .isEnabled(),
                  true
                )
                await page.evaluate(() => (window.rejectWrites = false))
              }
              await page
                .getByRole('button', { name: 'Start delivery', exact: true })
                .click()
              await page.waitForTimeout(200)
              assert.equal(
                await rootNode.getAttribute('data-order-page'),
                'handoff'
              )
            }
          }
          if (mode === 'courier') {
            await page.evaluate((v) => window.setScenario(v), {
              mode,
              viewer,
              phase: 'shipped',
            })
            await page.waitForTimeout(120)
            assert.equal(
              await rootNode.getAttribute('data-order-page'),
              'handoff'
            )
            assert.equal(
              await page
                .getByRole('button', { name: 'Confirm Received', exact: true })
                .count(),
              viewer === 'buyer' ? 1 : 0
            )
            assert.equal(
              await page
                .getByRole('button', { name: 'Cancel order', exact: true })
                .count(),
              0
            )
          }
        }
      assert.deepEqual(errors, [])
      console.log(
        `PASS ${width}: Buyer/Seller, all three modes, bounds/readonly history/refresh, exact copy, no tabs/overflow, separated actions and credentials.`
      )
      await page.close()
    }
    console.log(
      process.env.ORDER_UI_POLISH_ONLY
        ? 'Order Detail focused polish qualification passed, offline only.'
        : 'Order stage matrix: ' + cases + ' scenarios passed, offline only.'
    )
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
