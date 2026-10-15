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
async function run() {
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  fs.writeFileSync(
    path.join(root, 'link-mock.tsx'),
    'export const Link=({children,...props})=><a {...props}>{children}</a>'
  )
  aliases['@ui/link/link'] = path.join(root, 'link-mock.tsx')
  await build(aliases)
  for (const n of ['entry.tsx', 'api.ts', 'link-mock.tsx'])
    fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      p.setDefaultTimeout(8000)
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      const scenario = async (v) => {
        await p.evaluate((v) => window.setScenario(v), v)
        await p
          .locator('[data-current-step]:not([data-current-step="loading"])')
          .waitFor()
      }
      await scenario({ mode: 'campus', viewer: 'buyer', phase: 'review' })
      assert.equal(
        await p.locator('[data-formal-order]').getAttribute('data-order-page'),
        'review'
      )
      assert(
        await p.getByRole('button', { name: 'Next', exact: true }).isDisabled()
      )
      assert.equal(
        await p
          .locator('[data-slot="stepper"] li')
          .first()
          .getAttribute('data-done'),
        null
      )
      await p
        .getByRole('button', { name: 'Confirm Agreement', exact: true })
        .click()
      await p.getByText(/Agreement confirmed. Waiting for the Seller/).waitFor()
      assert(
        await p.getByRole('button', { name: 'Next', exact: true }).isDisabled()
      )
      await p.evaluate(() => {
        window.model.viewer = 'seller'
        window.renderModel()
      })
      await p
        .getByRole('button', { name: 'Confirm Agreement', exact: true })
        .click()
      await p.locator('[data-order-page="payment"]').waitFor()
      assert.notEqual(
        await p
          .locator('[data-slot="stepper"] li')
          .first()
          .getAttribute('data-done'),
        null
      )
      await scenario({ mode: 'campus', viewer: 'buyer', phase: 'paid' })
      assert(
        await p.getByRole('button', { name: 'Next', exact: true }).isDisabled()
      )
      const back = p
        .getByRole('navigation', { name: 'Order page navigation' })
        .getByRole('button', { name: 'Back', exact: true })
      assert(
        await back.isVisible(),
        'Meet / Inspect Back exists at every width'
      )
      await back.click()
      await p.locator('[data-order-page="payment"]').waitFor()
      await p.getByRole('button', { name: 'Next', exact: true }).click()
      await p.locator('[data-order-page="fulfillment"]').waitFor()
      const next = p.getByRole('button', { name: 'Next', exact: true })
      const grey = await next.evaluate(
        (e) => getComputedStyle(e.querySelector('span')).backgroundColor
      )
      assert.equal(grey, 'rgb(81, 75, 87)')
      await next.evaluate((e) => e.focus())
      assert(!(await next.evaluate((e) => e === document.activeElement)))
      assert.equal(await p.getByRole('img', { name: /Handoff QR/ }).count(), 0)
      assert(
        !(await p.getByLabel('6-digit handoff code').textContent()).includes(
          '123 456'
        )
      )
      await p.getByRole('button', { name: 'Show code', exact: true }).click()
      assert(
        (await p.getByLabel('6-digit handoff code').textContent()).includes(
          '123 456'
        )
      )
      await p.getByRole('button', { name: 'Hide code', exact: true }).click()
      const code = p.getByLabel('6-digit handoff code')
      const before = await code.boundingBox()
      await p
        .getByRole('button', { name: 'Generate QR code', exact: true })
        .click()
      await p.getByRole('img', { name: /Handoff QR/ }).waitFor()
      const generated = await code.boundingBox()
      assert.equal(generated.y, before.y)
      await p.getByText('QR expired', { exact: true }).waitFor()
      assert.equal((await code.boundingBox()).y, before.y)
      await p
        .getByRole('button', { name: 'Generate new QR code', exact: true })
        .click()
      await p.getByRole('img', { name: /Handoff QR/ }).waitFor()
      assert.equal((await code.boundingBox()).y, before.y)
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await scenario({ mode: 'campus', viewer: 'seller', phase: 'paid' })
      assert.equal(
        await p
          .getByRole('tab', { name: 'Scan QR', exact: true })
          .getAttribute('aria-selected'),
        'true'
      )
      const method = p.getByRole('region', {
        name: 'Handoff verification method',
      })
      const center = await method.evaluate((e) => {
        const outer = e.getBoundingClientRect(),
          inner = e
            .querySelector('[class*="methodContent"]')
            .getBoundingClientRect()
        return Math.abs(
          (outer.left + outer.right - inner.left - inner.right) / 2
        )
      })
      assert(center < 1, 'Seller inner block centered')
      const open = p.getByRole('button', { name: 'Open scanner', exact: true })
      assert.equal(await open.getAttribute('data-state'), 'idle')
      assert.equal(await open.locator('svg.lucide-arrow-right').count(), 1)
      assert.equal(
        await open.evaluate(
          (e) => getComputedStyle(e.firstElementChild).backgroundColor
        ),
        'rgb(22, 101, 52)'
      )
      if (width === 390 || width === 1280)
        await p.screenshot({
          path: path.join(root, 'seller-scan-' + width + '.png'),
          fullPage: true,
        })
      await p.getByRole('tab', { name: 'Enter code', exact: true }).click()
      const input = p.getByLabel('Buyer handoff code'),
        verify = p.getByRole('button', { name: 'Verify handoff', exact: true })
      const i = await input.boundingBox(),
        v = await verify.boundingBox()
      assert(v.x >= i.x + i.width, 'Verify is right of input')
      assert(
        v.y < i.y + i.height && i.y < v.y + v.height,
        'Input and Verify share row'
      )
      assert.equal(await verify.locator('svg.lucide-arrow-right').count(), 1)
      assert.equal(
        await verify.evaluate(
          (e) => getComputedStyle(e.firstElementChild).backgroundColor
        ),
        'rgb(22, 101, 52)'
      )
      if (width === 390 || width === 1280)
        await p.screenshot({
          path: path.join(root, 'seller-code-' + width + '.png'),
          fullPage: true,
        })
      await p.getByLabel('Buyer handoff code').fill('123456')
      await p
        .getByRole('button', { name: 'Verify handoff', exact: true })
        .click()
      await p.locator('[data-order-page="protection"]').waitFor()
      assert(
        await p.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      )
      await scenario({ mode: 'courier', viewer: 'buyer', phase: 'paid' })
      assert.equal(await p.getByLabel('Buyer handoff credential').count(), 0)
      for (const phase of ['completed', 'cancelled', 'expired']) {
        await scenario({ mode: 'campus', viewer: 'buyer', phase })
        assert.equal(
          await p
            .getByRole('button', { name: 'Confirm Agreement', exact: true })
            .count(),
          0
        )
      }
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': mutual Agreement/authoritative auto-alignment; grey native-disabled Next; masked code; fixed QR slot before/after generation, expiry and regeneration; Seller modes/manual auto-advance; Courier/history; no overflow'
      )
      await p.close()
    }
  } finally {
    await b.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
