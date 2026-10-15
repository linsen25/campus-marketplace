// Real shared OfferEditor default/revise/counter contracts, offline only.
/* global window */
const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict')
const { root, build } = require('./message-payload.browser.cjs')
const source = fs.readFileSync(
  'tests/messages-offer-correction.browser.cjs',
  'utf8'
)
new Function(
  'require',
  source.slice(0, source.indexOf('async function run()'))
)(require)
let entry = fs.readFileSync(path.join(root, 'entry.tsx'), 'utf8')
entry = entry.replace(
  "preferredFulfillment:'ON_CAMPUS'",
  "preferredFulfillment:v.delivery?'DELIVERY':'ON_CAMPUS',estimatedDeliveryFeeCents:v.estimate??1250,meetingLocation:v.defaultLocation?{label:'Listing front door',provider:'google',placeId:'listing_place'}:undefined"
)
entry = entry.replace(
  "meetupLocation:'Weldon',scheduledAt:",
  "meetupLocation:'Historical entrance',meetupLocationProvider:v.reference?'google':undefined,meetupPlaceId:v.reference?'historic_place':undefined,scheduledAt:"
)
entry = entry.replace(
  'onSend={()=>{window.sends++;',
  'onSend={terms=>{window.sentTerms=terms;window.sends++;'
)
entry = entry.replace(
  'const offer={',
  "if(v.delivery)Object.assign(terms,{fulfillment:'delivery',deliveryFeeCents:800,deliveryMethod:'seller_delivery',deliveryArea:{countryCode:'CA',provinceCode:'ON',cityLabel:'London',postalPrefix:'N6A'}});const offer={"
)
fs.writeFileSync(path.join(root, 'entry.tsx'), entry)
async function run() {
  await build(require('./browser-fixture-mocks.cjs')(root))
  for (const n of ['entry.tsx', 'api.ts']) fs.unlinkSync(path.join(root, n))
  const {
    chromium,
  } = require('./artifacts/browser-tools/node_modules/playwright-core')
  const browser = await chromium.launch({
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    headless: true,
  })
  try {
    for (const width of [390, 430, 820, 1280, 1536]) {
      const p = await browser.newPage({ viewport: { width, height: 900 } })
      await p.route(/^https?:/, (r) => r.abort())
      await p.addInitScript(() => (window.process = { env: {} }))
      await p.goto(
        'file:///' + path.join(root, 'index.html').replaceAll('\\', '/')
      )
      for (const defaultLocation of [true, false]) {
        await p.evaluate((v) => window.showCase(v), {
          kind: 'editor',
          fresh: true,
          viewer: 'buyer',
          defaultLocation,
        })
        assert.equal(
          await p.getByLabel('Meetup location', { exact: true }).inputValue(),
          defaultLocation ? 'Listing front door' : ''
        )
      }
      for (const viewer of ['buyer', 'seller']) {
        await p.evaluate((v) => window.showCase(v), {
          kind: 'editor',
          viewer,
          sender: 'seller',
          reference: true,
          defaultLocation: true,
        })
        const input = p.getByLabel('Meetup location', { exact: true })
        assert.equal(await input.inputValue(), 'Historical entrance')
        await p
          .getByRole('button', { name: 'Review Offer', exact: true })
          .click()
        await p.getByRole('dialog', { name: 'Review your Offer' }).waitFor()
        assert.equal(
          (await p.getByText('Meeting', { exact: true }).count()) > 0,
          true
        )
        const send =
          viewer === 'seller' ? 'Send Revised Offer' : 'Send Counter Offer'
        await p.getByRole('button', { name: send, exact: true }).click()
        await p.waitForFunction(() => window.sends === 1)
        assert.equal(
          await p.evaluate(() => window.sentTerms.meetupPlaceId),
          'historic_place'
        )
        assert.equal(
          await p.evaluate(() => window.sentTerms.meetupLocation),
          'Historical entrance'
        )
        await p.evaluate(() => window.resolveSend())
        await p.waitForFunction(() => window.closedCount === 1)
        await p.evaluate((v) => window.showCase(v), {
          kind: 'editor',
          viewer,
          sender: 'seller',
          reference: true,
          defaultLocation: true,
          edited: true,
        })
        await p
          .getByLabel('Meetup location', { exact: true })
          .fill('New user wording')
        await p
          .getByRole('button', { name: 'Review Offer', exact: true })
          .click()
        await p.getByRole('dialog', { name: 'Review your Offer' }).waitFor()
        await p.getByRole('button', { name: send, exact: true }).click()
        await p.waitForFunction(() => window.sends === 1)
        assert.equal(
          await p.evaluate(() => window.sentTerms.meetupLocation),
          'New user wording'
        )
        assert.equal(
          await p.evaluate(() =>
            Object.hasOwn(window.sentTerms, 'meetupPlaceId')
          ),
          false
        )
      }
      for (const [fresh, viewer, estimate, expected] of [
        [true, 'buyer', 1050, '10.50'],
        [true, 'buyer', 0, '0.00'],
        [false, 'seller', 2000, '8.00'],
        [false, 'buyer', 2000, '8.00'],
      ]) {
        await p.evaluate((v) => window.showCase(v), {
          kind: 'editor',
          fresh,
          viewer,
          delivery: true,
          estimate,
        })
        const fee = p.getByLabel('Delivery fee (CA$)', { exact: true })
        assert.equal(await fee.inputValue(), expected)
        await fee.fill('5.00')
        assert.equal(await fee.inputValue(), '5.00')
      }
      console.log(
        'PASS OfferEditor ' +
          width +
          ': Listing/legacy defaults, historical priority, Revise/Counter reference retention, manual edit clears metadata, Meeting display'
      )
      await p.close()
    }
  } finally {
    await browser.close()
  }
}
run().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
