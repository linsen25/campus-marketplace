// Real Order components and mobile shell/navigation; intercepted offline transport.
/* global window, document, getComputedStyle */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const source = fs.readFileSync(
  path.join(__dirname, 'order-flow-ui.browser.cjs'),
  'utf8'
)
new Function(
  'require',
  source.slice(0, source.indexOf('// Stage-based qualification entry point'))
)(require)
let entry = fs
  .readFileSync(path.join(root, 'entry.tsx'), 'utf8')
  .replaceAll('order-1', 'fda25a07-1c57-483e-93f1-2ae81b39b6c7')
entry = entry.replace(
  'const root=createRoot',
  `import shell from '@/components/home/animated-sidebar-demo.module.css';import {MarketMobileNavigation} from '@/components/listings/market-mobile-nav';
const root=createRoot`
)
entry = entry.replace(
  '<LazyMotion features={domAnimation}><FormalOrderDetail',
  `<LazyMotion features={domAnimation}><section className={shell.page}><div className={window.innerWidth<1024?shell.mobileShell:shell.frame}><main className={window.innerWidth<1024?shell.mobileMain:shell.main}>{!window.exited&&<FormalOrderDetail`
)
entry = entry.replace(
  "onBack={()=>window.actions.push('back')}",
  "onBack={()=>{window.actions.push('back');window.exited=true;window.renderModel()}}"
)
entry = entry.replace(
  '/></LazyMotion>))};',
  '/>}</main></div><MarketMobileNavigation/></section></LazyMotion>))};'
)
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
async function run() {
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  const mocks = {
    '@/components/loader/loader':
      "import {atom} from 'jotai';export const loaderFinishedAtom=atom(true)",
    '@/components/navigation/desktop-route-transition':
      "export function usePendingDestination(){return null}export function usePageSlide(){return ()=>{throw Error('Unexpected route navigation')}}",
    '@ui/link/link':
      'export const Link=({children,...props})=><a {...props}>{children}</a>',
  }
  for (const [name, text] of Object.entries(mocks)) {
    const file = path.join(
      root,
      'order-mobile-' + Object.keys(mocks).indexOf(name) + '.tsx'
    )
    fs.writeFileSync(file, text)
    aliases[name] = file
  }
  await build(aliases)
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  for (const file of Object.values(aliases))
    if (
      path.dirname(file) === root &&
      path.basename(file).startsWith('order-mobile-')
    )
      fs.unlinkSync(file)
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const b = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  let cases = 0
  try {
    for (const width of [390, 430, 1280, 1536]) {
      const p = await b.newPage({
        viewport: { width, height: 900 },
        reducedMotion: 'reduce',
      })
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.addInitScript(() => (window.process = { env: {} }))
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const mode of ['campus', 'seller_delivery', 'courier'])
        for (const viewer of ['buyer', 'seller'])
          for (const phase of [
            'review',
            'processing',
            'paid',
            'shipped',
            'protection',
            'cancelled',
            'expired',
            'completed',
          ]) {
            if (phase === 'shipped' && mode !== 'courier') continue
            await p.evaluate(
              (v) => {
                window.exited = false
                window.setScenario(v)
              },
              {
                mode,
                viewer,
                phase,
                startedDelivery: mode === 'seller_delivery' && phase === 'paid',
              }
            )
            await p.waitForTimeout(100)
            const detail = p.getByRole('region', {
                name: 'Order Detail',
                exact: true,
              }),
              nav = detail.getByRole('navigation', {
                name: 'Order page navigation',
              }),
              capsule = p.getByRole('navigation', {
                name: 'Home and Market navigation',
              }),
              top = detail.getByRole('button', {
                name:
                  viewer === 'buyer' ? 'Back to Purchases' : 'Back to Sales',
                exact: true,
              })
            assert(await top.isVisible())
            assert.equal(
              await detail.evaluate((e) => getComputedStyle(e).paddingBottom),
              ['cancelled', 'expired', 'completed'].includes(phase)
                ? '24px'
                : '0px'
            )
            if (['cancelled', 'expired', 'completed'].includes(phase)) {
              const endGap = await detail.evaluate(
                (e) =>
                  e.getBoundingClientRect().bottom -
                  e.lastElementChild.getBoundingClientRect().bottom
              )
              assert(
                Math.abs(endGap - 24) < 1,
                'History has 24px after its final real content block'
              )
            }
            const geom = await detail.evaluate((e) => ({
              padding: getComputedStyle(e.closest('main')).paddingBottom,
              width: e.getBoundingClientRect().width,
              hasNext: !!e.querySelector(
                'nav button:not([data-action-direction="back"])'
              ),
            }))
            if (width < 1024) {
              assert(!(await capsule.isVisible()))
              assert.equal(geom.padding, '12px')
              assert.equal(
                await detail
                  .getByRole('button', { name: 'Back', exact: true })
                  .count(),
                0
              )
              if (
                ['cancelled', 'expired', 'completed', 'protection'].includes(
                  phase
                )
              )
                assert.equal(await nav.count(), 0)
              if (phase === 'review') {
                const next = nav.getByRole('button', {
                  name: 'Next',
                  exact: true,
                })
                assert(await next.isVisible())
                const boxes = await next.evaluate((e) => ({
                  b: e.getBoundingClientRect().toJSON(),
                  p: e.closest('nav').getBoundingClientRect().toJSON(),
                }))
                assert(Math.abs(boxes.b.right - boxes.p.right) < 1)
                await next.click()
                await p.waitForFunction(
                  () =>
                    document.querySelector('[data-order-page]').dataset
                      .orderPage === 'payment'
                )
                assert.equal(
                  await detail.getAttribute('data-order-page'),
                  'payment'
                )
                assert.equal(
                  await detail
                    .getByRole('button', { name: 'Back', exact: true })
                    .count(),
                  0
                )
                assert.equal(await nav.count(), 0)
              }
            } else {
              assert.equal(geom.padding, '24px')
              if (['cancelled', 'expired', 'completed'].includes(phase)) {
                assert.equal(await nav.count(), 0)
                assert.equal(
                  await detail
                    .getByRole('button', { name: 'Back', exact: true })
                    .count(),
                  0
                )
              } else {
                assert.equal(await nav.count(), 1)
                if (phase !== 'review')
                  assert(
                    await nav
                      .getByRole('button', { name: 'Back', exact: true })
                      .isVisible()
                  )
                assert.equal(
                  await nav.evaluate((e) => getComputedStyle(e).paddingBottom),
                  '24px'
                )
                if (phase !== 'review') {
                  const markers = await detail
                    .locator('[data-slot="stepper"]')
                    .innerText()
                  await nav
                    .getByRole('button', { name: 'Back', exact: true })
                    .click()
                  assert.equal(
                    await detail.locator('[data-slot="stepper"]').innerText(),
                    markers
                  )
                }
              }
            }
            assert.equal(
              await p.evaluate(
                () => window.requests.filter((r) => r.method === 'POST').length
              ),
              0
            )
            assert(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth
              )
            )
            await top.click()
            assert.equal(await detail.count(), 0)
            assert.deepEqual(await p.evaluate(() => window.actions), ['back'])
            if (width < 1024) {
              assert(await capsule.isVisible())
              assert.equal(
                await p
                  .locator('main')
                  .evaluate((e) => getComputedStyle(e).paddingBottom),
                '80px'
              )
            }
            cases++
          }
      assert.deepEqual(errors, [])
      console.log(
        'PASS ' +
          width +
          ': roles/modes/lifecycles, capsule/reservation restore, top exit, valid Next only on mobile, no empty historical nav at every width; active desktop stage navigation retained.'
      )
      await p.close()
    }
    console.log(
      'PASS ' +
        cases +
        ' offline Order mobile navigation cases; zero hosted writes.'
    )
  } finally {
    await b.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
