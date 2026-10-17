/* global window, document */
// Offline real shared Order list/detail; synthetic DTOs, no hosted requests.
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
entry =
  `import {FormalOrders} from '@/components/home/formal-orders';\n` +
  entry +
  `
window.renderModel=()=>{const m=window.model;flushSync(()=>root.render(<LazyMotion features={domAnimation}><FormalOrders mode={m.viewer==='seller'?'sales':'purchases'}/></LazyMotion>))};
const originalScenario=window.setScenario;window.provenanceCase=(v)=>{window.showDetail=v.detail;originalScenario({mode:'campus',phase:'cancelled',viewer:v.viewer});window.model.order.listingProvenance=v.provenance;window.renderModel()};
`
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
const aliases = require('./browser-fixture-mocks.cjs')(root)
fs.writeFileSync(
  path.join(root, 'provenance-router.js'),
  `export function useRouter(){const m=window.model;return {query:{section:'orders',destination:m.viewer==='seller'?'sales':'purchases',orderView:'history',...(window.showDetail?{order:m.order.id}:{})},pathname:'/home',push:async()=>{}}}`
)
fs.writeFileSync(
  path.join(root, 'provenance-orders.js'),
  `export function useFormalOrders(){const m=window.model;return {loading:false,error:'',userId:m.viewer,data:{orders:[m.order]},offset:0,applyOrder(){},refresh:window.refreshModel}}`
)
aliases['next/router'] = path.join(root, 'provenance-router.js')
aliases['@/hooks/use-formal-orders'] = path.join(root, 'provenance-orders.js')
;(async () => {
  fs.writeFileSync(
    path.join(root, 'index.html'),
    fs
      .readFileSync(path.join(root, 'index.html'), 'utf8')
      .replace(
        '<script src=',
        '<script>window.process={env:{}}</script><script src='
      )
  )
  await build(aliases)
  fs.unlinkSync(path.join(root, 'entry.tsx'))
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
      const errors = []
      p.on('pageerror', (e) => errors.push(e.message))
      await p.route(/^https?:/, (r) => r.abort())
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      assert.deepEqual(errors, [])
      await p.waitForFunction(() => typeof window.provenanceCase === 'function')
      for (const viewer of ['buyer', 'seller'])
        for (const detail of [false, true])
          for (const provenance of [
            undefined,
            { channel: 'resale' },
            { channel: 'shop', shopName: 'Vintage Loop' },
            {
              channel: 'shop',
              shopName: 'VeryLongShopNameWithoutAnySpacesAtAllXXXX',
            },
          ]) {
            await p.evaluate((v) => window.provenanceCase(v), {
              viewer,
              detail,
              provenance,
            })
            await p.getByText('Frozen fixture', { exact: true }).waitFor()
            if (provenance?.channel === 'shop')
              await p
                .getByText(provenance.shopName + ' \u00b7 Shop', {
                  exact: true,
                })
                .waitFor()
            else assert.equal(await p.getByText(/\u00b7 Shop/).count(), 0)
            assert.equal(await p.getByText('PRO', { exact: true }).count(), 0)
            assert(
              await p.evaluate(
                () => document.documentElement.scrollWidth <= window.innerWidth
              ),
              'no overflow'
            )
          }
      assert.deepEqual(errors, [])
      await p.close()
      console.log(
        'PASS',
        width,
        'Purchases/Sales list/detail old/new Resale and frozen Shop, long name, no PRO/overflow'
      )
    }
  } finally {
    await b.close()
  }
})().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
