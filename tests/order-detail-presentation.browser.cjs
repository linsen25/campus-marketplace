// Actual Order components and hooks, offline synthetic projections only.
/* global window, document, getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const source = fs.readFileSync('tests/order-flow-ui.browser.cjs', 'utf8')
new Function(
  'require',
  source.slice(0, source.indexOf('// Stage-based qualification entry point'))
)(require)
let entry = fs.readFileSync(path.join(root, 'entry.tsx'), 'utf8')
entry = entry.replace(
  "fulfillment:{orderId:'order-1',",
  "fulfillment:{agreement:{orderId:'order-1',complete:paid||v.confirmed,buyerConfirmedAt:v.confirmed?'confirmed':null,sellerConfirmedAt:v.confirmed?'confirmed':null},orderId:'order-1',"
)
entry += `
const originalRequest=window.fixtureRequest;
window.fixtureRequest=async(url,method,body)=>{
if(url.endsWith('/confirm-agreement')){const a=window.model.fulfillment.agreement;a[window.model.viewer==='buyer'?'buyerConfirmedAt':'sellerConfirmedAt']=new Date().toISOString();a.complete=Boolean(a.buyerConfirmedAt&&a.sellerConfirmedAt);return a}
if(url.endsWith('/generate-qr'))return {available:true,qrToken:'a'.repeat(64),serverTime:new Date().toISOString(),expiresAt:new Date(Date.now()+1200).toISOString()};
return originalRequest(url,method,body)};
window.fetch=async(url,opts)=>{if(!url.endsWith('/handoff'))throw Error('Unexpected fetch');const body=JSON.parse(opts.body);if(body.credential!=='123456')throw Error('Invalid fixture credential');const f=window.model.fulfillment;f.handoffReady=false;f.handoffConfirmedAt=f.protectionStartedAt=new Date().toISOString();return new Response(JSON.stringify({verified:true}),{status:200})};
`
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
fs.writeFileSync(
  path.join(root, 'entry.tsx'),
  fs
    .readFileSync(path.join(root, 'entry.tsx'), 'utf8')
    .replaceAll('order-1', 'fda25a07-1c57-483e-93f1-2ae81b39b6c7')
)
async function run() {
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  const link = path.join(root, 'detail-link-mock.tsx')
  fs.writeFileSync(
    link,
    'export const Link=({children,...props})=><a {...props}>{children}</a>'
  )
  aliases['@ui/link/link'] = link
  await build(aliases)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let cases = 0
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.addInitScript(() => {
        window.process = { env: {} }
      })
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const viewer of ['buyer', 'seller']) {
        for (const scenario of [
          {
            mode: 'campus',
            phase: 'review',
            done: 0,
            current: 0,
            page: 'review',
          },
          {
            mode: 'campus',
            phase: 'processing',
            confirmed: true,
            done: 1,
            current: 1,
            page: 'payment',
          },
          {
            mode: 'campus',
            phase: 'paid',
            done: 2,
            current: 2,
            page: 'fulfillment',
          },
          {
            mode: 'seller_delivery',
            phase: 'paid',
            startedDelivery: true,
            done: 3,
            current: 3,
            page: 'handoff',
          },
          {
            mode: 'campus',
            phase: 'protection',
            done: 4,
            current: 4,
            page: 'protection',
          },
          {
            mode: 'campus',
            phase: 'completed',
            done: 6,
            current: null,
            page: 'completed',
          },
          {
            mode: 'courier',
            phase: 'shipped',
            done: 3,
            current: 3,
            page: 'handoff',
          },
          {
            mode: 'campus',
            phase: 'cancelled',
            done: 0,
            current: null,
            page: 'closed',
          },
        ]) {
          await p.evaluate((v) => window.setScenario(v), {
            ...scenario,
            viewer,
          })
          await p
            .locator('[data-current-step]:not([data-current-step="loading"])')
            .waitFor()
          await p.waitForTimeout(180)
          assert.equal(
            await p
              .locator('[data-order-page]')
              .getAttribute('data-order-page'),
            scenario.page
          )
          assert.equal(
            await p.getByText('Order Detail', { exact: true }).count(),
            0
          )
          const progress = p.getByRole('region', {
            name: 'Order Progress',
            exact: true,
          })
          assert.equal(await progress.locator('li').count(), 6)
          assert.equal(
            await progress.locator('li[data-done]').count(),
            scenario.done
          )
          assert.equal(
            await progress.locator('[aria-current="step"]').count(),
            scenario.current === null ? 0 : 1
          )
          if (scenario.current !== null)
            assert.equal(
              await progress
                .locator('li')
                .nth(scenario.current)
                .getAttribute('aria-current'),
              'step'
            )
          const positions = await progress.locator('li').evaluateAll((nodes) =>
            nodes.map((n) => {
              const m = n.firstElementChild,
                r = m.getBoundingClientRect()
              return {
                x: r.x,
                y: r.y,
                w: r.width,
                h: r.height,
                color: getComputedStyle(m).backgroundColor,
                connector: getComputedStyle(n, '::after').top,
              }
            })
          )
          if (width < 768)
            assert(
              positions.every((r, i) => !i || r.y > positions[i - 1].y),
              'vertical mobile timeline'
            )
          else
            assert(
              positions.every((r) => Math.abs(r.y - positions[0].y) < 1),
              'horizontal desktop timeline'
            )
          for (let i = 0; i < scenario.done; i++)
            assert.equal(positions[i].color, 'rgb(124, 58, 237)')
          const current = p.getByRole('region', {
            name: 'Current Step',
            exact: true,
          })
          assert.equal(
            await current.evaluate((e) => getComputedStyle(e).backgroundColor),
            'rgb(28, 21, 36)'
          )
          const actions = p.getByRole('region', {
            name: 'Current-stage actions',
            exact: true,
          })
          if (await actions.count())
            assert(
              await actions.evaluate((e) =>
                Boolean(e.closest('[aria-label="Current Step"]'))
              )
            )
          if (viewer === 'seller')
            assert.equal(
              await p
                .getByLabel('6-digit handoff code', { exact: true })
                .count(),
              0
            )
          else
            assert.equal(
              await p
                .getByRole('button', { name: 'Open scanner', exact: true })
                .count(),
              0
            )
          assert.equal(
            await p
              .getByRole('button', { name: /^Back to (Sales|Purchases)$/ })
              .count(),
            1
          )
          assert(
            await p.evaluate(
              () => document.documentElement.scrollWidth <= window.innerWidth
            ),
            'no horizontal overflow'
          )
          // No completion dates are fabricated from createdAt when Agreement timestamps are absent.
          if (scenario.phase === 'paid')
            assert.equal(
              await progress.locator('li').first().locator('time').count(),
              0
            )
          if (['completed', 'cancelled'].includes(scenario.phase))
            assert.equal(
              await p
                .getByRole('navigation', { name: 'Order page navigation' })
                .count(),
              0
            )
          if (scenario.phase === 'paid' && scenario.mode === 'campus') {
            if (viewer === 'buyer') {
              const generate = p.getByRole('button', {
                name: 'Generate QR code',
                exact: true,
              })
              assert.equal(
                await generate.evaluate(
                  (e) => getComputedStyle(e.firstElementChild).backgroundColor
                ),
                'rgb(124, 58, 237)'
              )
              const nav = p.getByRole('navigation', {
                name: 'Order page navigation',
              })
              await nav
                .getByRole('button', { name: 'Back', exact: true })
                .click()
              await p.locator('[data-order-page="payment"]').waitFor()
              const next = nav.getByRole('button', {
                name: 'Next',
                exact: true,
              })
              assert(await next.isEnabled())
              assert.equal(
                await next
                  .locator('.shining-button__body')
                  .evaluate((e) => getComputedStyle(e).backgroundColor),
                'rgb(124, 58, 237)'
              )
              await next.click()
              await p.locator('[data-order-page="fulfillment"]').waitFor()
              assert(await next.isDisabled())
              assert.equal(
                await next
                  .locator('.shining-button__body')
                  .evaluate((e) => getComputedStyle(e).backgroundColor),
                'rgb(81, 75, 87)'
              )
            } else {
              const tab = p.getByRole('tab', { name: 'Scan QR', exact: true })
              assert.equal(
                await tab
                  .locator('span[aria-hidden="true"]')
                  .first()
                  .evaluate((e) => getComputedStyle(e).backgroundColor),
                'rgb(124, 58, 237)'
              )
              const open = p.getByRole('button', {
                name: 'Open scanner',
                exact: true,
              })
              assert.equal(
                await open.evaluate(
                  (e) => getComputedStyle(e.firstElementChild).backgroundColor
                ),
                'rgb(22, 101, 52)'
              )
            }
          }
          if (scenario.phase === 'protection') {
            const timer = p.locator('[data-order-countdown="protection"]')
            assert.match(
              await timer.textContent(),
              /^\d+h \d{2}m \d{2}s remaining$/
            )
            const report = p.getByRole('button', {
              name: 'Report an issue',
              exact: true,
            })
            assert.equal(
              await report.count(),
              viewer === 'buyer' ? 1 : 0,
              'Buyer-only report authority unchanged'
            )
            if (viewer === 'buyer') {
              assert(await report.isDisabled())
              const select = p.getByRole('combobox', {
                name: 'Protection issue reason',
              })
              await select.scrollIntoViewIfNeeded()
              const gap =
                (await report.boundingBox()).y -
                ((await select.boundingBox()).y +
                  (await select.boundingBox()).height)
              assert(gap >= 12 && gap <= 18, '16px select/action spacing')
              await select.click()
              const option = p.getByRole('option', {
                name: 'Item not received',
                exact: true,
              })
              await option.waitFor()
              const menu = p.locator('[popover]:popover-open')
              assert.equal(await menu.count(), 1)
              if (width >= 1024) {
                assert.equal(await menu.getAttribute('data-side'), 'top')
                const m = await menu.boundingBox(),
                  t = await select.boundingBox()
                assert(
                  m.y + m.height <= t.y + 1,
                  'Desktop menu is actually above trigger'
                )
              }
              await select.press('Escape')
              await p.waitForTimeout(160)
              await select.press('ArrowDown')
              await option.waitFor()
              await option.click()
              assert(await report.isEnabled())
              assert.equal(
                await report.evaluate(
                  (e) => getComputedStyle(e.firstElementChild).backgroundColor
                ),
                'rgb(124, 58, 237)'
              )
              await report.click()
              await p.getByText(/Protection on hold/).waitFor()
              const writes = await p.evaluate(() =>
                window.requests.filter(
                  (r) => r.method === 'POST' && r.url.endsWith('/case')
                )
              )
              assert.equal(writes.length, 1)
              assert.equal(writes[0].body.reason, 'ITEM_NOT_RECEIVED')
              assert(writes[0].body.clientActionId)
            }
          }
          if (scenario.phase === 'protection' && viewer === 'buyer')
            await p.screenshot({
              path: path.join(root, 'detail-progress-' + width + '.png'),
              fullPage: true,
            })
          cases++
        }
      }
      // Existing disclosure and destructive confirmation still own cancellation.
      for (const viewer of ['buyer', 'seller']) {
        await p.evaluate(
          (v) =>
            window.setScenario({ mode: 'campus', phase: 'review', viewer: v }),
          viewer
        )
        const cancel = p.getByRole('region', {
          name: 'Cancel Order',
          exact: true,
        })
        const review = cancel.getByRole('button', {
          name: 'Review cancellation',
          exact: true,
        })
        await review.click()
        assert.equal(await review.getAttribute('aria-expanded'), 'true')
        const confirm = cancel.getByRole('button', {
          name: 'Confirm cancellation',
          exact: true,
        })
        assert(await confirm.isDisabled())
        await cancel
          .getByRole('combobox', { name: 'Cancellation context' })
          .click()
        await p
          .getByRole('option', {
            name: viewer === 'buyer' ? 'Changed my mind' : 'Item unavailable',
            exact: true,
          })
          .click()
        assert(await confirm.isEnabled())
        assert.equal(
          await p.evaluate(
            () => window.requests.filter((r) => r.method === 'POST').length
          ),
          0
        )
        await confirm.click()
        await p.locator('[data-order-page="closed"]').waitFor()
        assert.equal(
          await p.evaluate(
            () => window.requests.filter((r) => r.method === 'POST').length
          ),
          1
        )
      }
      // Preserve the separate authoritative external-payment progress, without hidden UU steps.
      await p.evaluate(() => {
        window.setScenario({ mode: 'campus', phase: 'review', viewer: 'buyer' })
        window.model.order.v2.terms.paymentMode = 'external'
        window.model.fulfillment.agreement.complete = true
        window.model.fulfillment.externalExchange = {
          status: 'awaiting_both',
          buyerConfirmedAt: null,
          sellerConfirmedAt: null,
        }
        window.model.order = { ...window.model.order }
        window.model.key = 'external'
        window.renderModel()
      })
      await p.locator('[data-order-page="fulfillment"]').waitFor()
      assert.equal(await p.locator('[data-slot="stepper"] li').count(), 4)
      assert.equal(
        await p
          .getByRole('button', { name: 'Open scanner', exact: true })
          .count(),
        0
      )
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': all six stages, Buyer/Seller, actual progress states, shared shell, mobile vertical / desktop horizontal, timestamps, no overflow'
      )
      await p.close()
    }
    console.log(
      'PASS ' +
        cases +
        ' offline Order Detail presentation cases; no hosted access'
    )
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
