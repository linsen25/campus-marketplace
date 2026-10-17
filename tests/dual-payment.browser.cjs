/* global window, document */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const original = fs.readFileSync('tests/order-flow-ui.browser.cjs', 'utf8')
new Function(
  'require',
  original.slice(
    0,
    original.indexOf('// Stage-based qualification entry point')
  )
)(require)
let entry = fs.readFileSync(path.join(root, 'entry.tsx'), 'utf8')
entry = entry.replace(
  'if(window.rejectWrites)throw',
  `if(url.endsWith('/confirm-exchange')){const e=m.fulfillment.externalExchange;if(m.viewer==='buyer')e.buyerConfirmedAt=now();else e.sellerConfirmedAt=now();e.status=e.buyerConfirmedAt&&e.sellerConfirmedAt?'confirmed':m.viewer+'_confirmed';m.fulfillment.cancellation.canCancel=false;if(e.status==='confirmed'){o.lifecycle='completed';o.holdsListing=false}return {...e}}
if(url.endsWith('/dispute-exchange')){m.fulfillment.externalExchange.status='disputed';return {...m.fulfillment.externalExchange}}
if(window.rejectWrites)throw`
)
entry += `
window.externalScenario=(viewer,phase)=>{window.setScenario({viewer,phase:'pending',mode:'campus'});const m=window.model;m.key=viewer+phase;m.order.v2.terms.paymentMode='external';m.order.economics.buyerServiceFeeCents=0;m.order.economics.buyerTotalCents=7000;m.order.campusPayment=undefined;m.fulfillment.agreement={complete:true};m.fulfillment.externalExchange={orderId:m.order.id,status:phase,buyerConfirmedAt:phase==='buyer_confirmed'?now():null,sellerConfirmedAt:phase==='seller_confirmed'?now():null};m.fulfillment.cancellation.canCancel=phase==='awaiting_both';window.renderModel()};
`
entry += `\nimport {AgreementCard} from '@/components/home/agreement-card';window.showExternalAgreement=()=>{const m=window.model;root.render(<LazyMotion features={domAnimation}><AgreementCard agreement={{id:'external',offerId:'offer',status:'open',createdAt:new Date().toISOString(),listingTitle:'Synthetic Listing',buyerId:'buyer',sellerId:'seller',terms:m.order.v2.terms}} onView={()=>{}}/></LazyMotion>)};\n`
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
async function run() {
  const aliases = require('./browser-fixture-mocks.cjs')(root)
  fs.writeFileSync(
    path.join(root, 'link-mock.tsx'),
    'export const Link=({children,...props})=><a {...props}>{children}</a>'
  )
  aliases['@ui/link/link'] = path.join(root, 'link-mock.tsx')
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
      const page = await browser.newPage({ viewport: { width, height: 900 } })
      await page.route(/^https?:/, (r) => r.abort())
      await page.goto(
        'file://' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const viewer of ['buyer', 'seller']) {
        await page.evaluate(
          (v) => window.externalScenario(v, 'awaiting_both'),
          viewer
        )
        await page
          .getByRole('heading', { name: 'Meet / Inspect', exact: true })
          .waitFor()
        assert.equal(
          await page.getByText('Payment', { exact: true }).count(),
          0
        )
        assert.equal(
          await page.getByText('Protection', { exact: true }).count(),
          0
        )
        assert.equal(
          await page
            .getByRole('button', {
              name: /Pay now|Open scanner|Verify handoff/,
            })
            .count(),
          0
        )
        await page.getByRole('button', { name: /Next/ }).click()
        const confirm = page.getByRole('button', {
          name: 'Confirm exchange',
          exact: true,
        })
        await confirm.waitFor()
        await confirm.click()
        await page.getByText(/You confirmed the exchange/).waitFor()
        assert.equal(
          await page
            .getByRole('button', { name: 'Confirm exchange', exact: true })
            .count(),
          0
        )
        assert.equal(
          await page.evaluate(() => window.model.order.paymentStatus),
          'pending'
        )
        assert.equal(
          await page.evaluate(() =>
            window.requests.some((r) =>
              /credential|generate-qr|\/payment/.test(r.url)
            )
          ),
          false
        )
        const other =
          viewer === 'buyer' ? 'seller_confirmed' : 'buyer_confirmed'
        await page.evaluate((v) => window.externalScenario(v.viewer, v.other), {
          viewer,
          other,
        })
        await page
          .getByRole('button', { name: 'Confirm exchange', exact: true })
          .waitFor()
        await page
          .getByPlaceholder('Describe the disagreement')
          .fill('Exchange did not occur')
        await page
          .getByRole('button', { name: 'Report disagreement', exact: true })
          .click()
        await page.getByText(/External exchange disputed/).waitFor()
        assert.equal(
          await page.evaluate(() => window.model.order.holdsListing),
          true
        )
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        ),
        false
      )
      await page.evaluate(() => window.showExternalAgreement())
      await page
        .getByText('Paid outside UU \u00b7 No UU payment protection', {
          exact: true,
        })
        .waitFor()
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth
        ),
        false
      )
      console.log(
        'PASS external Order ' +
          width +
          ': Buyer/Seller, no payment/QR/protection, confirmation/wait/dispute, no overflow'
      )
      await page.close()
    }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
